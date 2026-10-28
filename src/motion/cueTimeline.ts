// キュー列(字幕時刻)に身振り列を載せるタイムライン。純粋関数。方針は docs/spec.md「字幕時刻との同期」。
//  - 各キューの区間 [start, end) に、そのキューの身振り列を収める。end は次キューの start で打ち切る。
//  - 身振り列が区間より長いとき: 速度を上げて収める。ただし上限 MAX_SPEED 倍まで。それでも収まらない末尾の身振りは省略し、字幕のみにする。
//  - 短いとき: 身振りの後は待機姿勢へ戻して区間の終わりまで待つ(引き伸ばさない)。
//  - 姿勢は常に連続: 待機への復帰は区間終端を越えても続け、隙間のないキューの先頭は前の姿勢から BLEND_IN で寄せる。
import type { Cue } from '../import/cues';
import type { SequenceItem } from '../text/vocabulary';
import { applyEase, lerpFullPose, samplePose } from './interpolate';
import type { FullPose } from './interpolate';
import { REST_POSE } from './rest';
import { TRANSITION, buildTimeline, sampleTimeline } from './timeline';
import type { Timeline } from './timeline';

/** 身振りの再生速度の上限(倍) */
export const MAX_SPEED = 1.5;
/** キュー開始前に待機姿勢から先頭姿勢へ寄せる時間(秒)。身振り本体の開始時刻は動かさない */
export const LEAD_IN = 0.3;
/** 身振りが終わってから待機姿勢へ戻る時間(秒)。キューの区間を越えても戻り続ける */
export const RETURN_TO_REST = TRANSITION;
/** 隙間なく続くキューの境界で、前のキューの姿勢から先頭の姿勢へ寄せる時間(秒) */
export const BLEND_IN = TRANSITION;

export type CueSegment = Readonly<{
  index: number;
  cue: Cue;
  /** 次キューの開始で打ち切った実効の終了時刻 */
  end: number;
  /** 収めた身振りのタイムライン(自然な速度。無ければ null=字幕のみ) */
  gestures: Timeline | null;
  /** 再生速度(1 以上、MAX_SPEED 以下) */
  speed: number;
  /** 速度上限のため省略した語(字幕のみになる) */
  omitted: readonly string[];
  /** 身振りに対応しない語(字幕のみ) */
  unsupported: readonly string[];
}>;

export type CueTimeline = Readonly<{ segments: readonly CueSegment[]; total: number }>;

export function buildCueTimeline(
  cues: readonly Cue[],
  toItems: (text: string) => readonly SequenceItem[],
  transition: number = TRANSITION,
): CueTimeline {
  const segments: CueSegment[] = cues.map((cue, index) => {
    const next = cues[index + 1];
    const end = next ? Math.min(cue.end, Math.max(next.start, cue.start)) : cue.end;
    const items = toItems(cue.text);
    const unsupported = items.flatMap((it) => (it.kind === 'unknown' ? [it.token] : []));
    const motions = items.filter((it) => it.kind === 'motion');
    const budget = (end - cue.start) * MAX_SPEED;
    // 先頭から、速度上限で収まる範囲だけ採る
    let kept = motions.length;
    while (kept > 0 && buildTimeline(motions.slice(0, kept), transition).total > budget + 1e-9) kept -= 1;
    const gestures = kept > 0 ? buildTimeline(motions.slice(0, kept), transition) : null;
    const duration = end - cue.start;
    const speed = gestures && duration > 0 ? Math.min(MAX_SPEED, Math.max(1, gestures.total / duration)) : 1;
    return { index, cue, end, gestures, speed, omitted: motions.slice(kept).map((m) => m.token), unsupported };
  });
  return { segments, total: segments.reduce((m, s) => Math.max(m, s.end), 0) };
}

export type CueSample = Readonly<{
  pose: FullPose;
  /** 字幕として表示するキューの index(区間外は -1) */
  cueIndex: number;
  /** 現在の身振り(gestures の segment index。身振りなし・待機中は -1) */
  gestureIndex: number;
  phase: 'idle' | 'lead-in' | 'gesture' | 'rest';
}>;

/** キュー seg の姿勢を時刻 t(キュー開始以降なら区間終端を越えてもよい)で評価する。身振りの後は RETURN_TO_REST で待機姿勢へ戻る */
function poseInCue(seg: CueSegment, t: number): FullPose {
  if (!seg.gestures) return REST_POSE;
  const local = (t - seg.cue.start) * seg.speed;
  if (local <= seg.gestures.total) return sampleTimeline(seg.gestures, local).pose;
  const u = Math.min(1, (local - seg.gestures.total) / seg.speed / RETURN_TO_REST);
  return u >= 1 ? REST_POSE : lerpFullPose(sampleTimeline(seg.gestures, seg.gestures.total).pose, REST_POSE, u);
}

export function sampleCueTimeline(ct: CueTimeline, t: number): CueSample {
  const segs = ct.segments;
  // 区間内: 開始が最も遅いキュー(重なりは後勝ち)
  let active = -1;
  for (let i = 0; i < segs.length; i++) if (segs[i].cue.start <= t && t < segs[i].end) active = i;
  if (active >= 0) {
    const s = segs[active];
    let pose = poseInCue(s, t);
    const prev = segs[active - 1];
    // 隙間なく続く(または重なる)キューの先頭: 前のキューの姿勢から寄せる
    if (prev && prev.end >= s.cue.start - 1e-9 && t - s.cue.start < BLEND_IN) {
      pose = lerpFullPose(poseInCue(prev, t), pose, applyEase('ease-in-out', (t - s.cue.start) / BLEND_IN));
    }
    if (!s.gestures) return { pose, cueIndex: active, gestureIndex: -1, phase: 'rest' };
    const local = (t - s.cue.start) * s.speed;
    if (local <= s.gestures.total) return { pose, cueIndex: active, gestureIndex: sampleTimeline(s.gestures, local).segmentIndex, phase: 'gesture' };
    return { pose, cueIndex: active, gestureIndex: -1, phase: 'rest' };
  }
  // 区間外: 直前のキューの復帰を続け、次のキュー直前なら LEAD_IN で先頭姿勢へ寄せる
  let prevIdx = -1;
  for (let i = 0; i < segs.length; i++) if (segs[i].cue.start <= t) prevIdx = i;
  const base = prevIdx >= 0 ? poseInCue(segs[prevIdx], t) : REST_POSE;
  const upcoming = segs[prevIdx + 1];
  if (upcoming?.gestures && upcoming.cue.start - t < LEAD_IN) {
    const windowStart = Math.max(prevIdx >= 0 ? segs[prevIdx].end : -Infinity, upcoming.cue.start - LEAD_IN);
    const u = (t - windowStart) / (upcoming.cue.start - windowStart);
    const first = samplePose(upcoming.gestures.segments[0].motion!, 0);
    return { pose: lerpFullPose(base, first, applyEase('ease-in-out', u)), cueIndex: -1, gestureIndex: -1, phase: 'lead-in' };
  }
  return { pose: base, cueIndex: -1, gestureIndex: -1, phase: 'idle' };
}
