// キュー列(字幕時刻)に身振り列を載せるタイムライン。純粋関数。方針は docs/spec.md「字幕時刻との同期」。
//  - 各キューの区間 [start, end) に、そのキューの身振り列を収める。end は次キューの start で打ち切る。
//  - 身振り列が区間より長いとき: 速度を上げて収める。ただし上限 MAX_SPEED 倍まで。それでも収まらない末尾の身振りは省略し、字幕のみにする。
//  - 短いとき: 身振りの後は待機姿勢へ戻して区間の終わりまで待つ(引き伸ばさない)。
//  - 姿勢は常に連続(瞬間移動しない):
//      * 待機への復帰(RETURN_TO_REST)は区間終端を越えても続く。total は最後の復帰が終わるまで延ばす。
//      * 前のキューとの隙間が LEAD_IN 以上で、次が身振りありのキュー: 開始 LEAD_IN 前から待機(復帰の続き)→先頭姿勢へ寄せる。
//      * 隙間が LEAD_IN 未満、または字幕のみのキュー: キュー開始から BLEND_IN で、前のキューの(自身のブレンドを含む)姿勢→自分の姿勢へ寄せる。
//      * 長さ 0 の区間(開始時刻が同じキューの手前側)は前後のキューとして扱わない。
import type { Cue } from '../import/cues';
import type { SequenceItem } from '../text/vocabulary';
import { applyEase, lerpFullPose, samplePose } from './interpolate';
import type { FullPose } from './interpolate';
import { REST_POSE } from './rest';
import { TRANSITION, buildTimeline, sampleTimeline } from './timeline';
import type { Timeline } from './timeline';

/** 身振りの再生速度の上限(倍) */
export const MAX_SPEED = 1.5;
/** 隙間がこれ以上あるとき、キュー開始前に先頭姿勢へ寄せる時間(秒)。身振り本体の開始時刻は動かさない */
export const LEAD_IN = 0.3;
/** 身振りが終わってから待機姿勢へ戻る時間(秒)。キューの区間を越えても戻り続ける */
export const RETURN_TO_REST = TRANSITION;
/** 隙間が LEAD_IN 未満(または字幕のみ)のキューの開始後、前の姿勢から自分の姿勢へ寄せる時間(秒) */
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
  // 最後の身振りの待機への復帰が終わるまでを再生時間に含める
  const total = segments.reduce((m, s) => Math.max(m, s.end, s.gestures ? s.cue.start + s.gestures.total / s.speed + RETURN_TO_REST : 0), 0);
  return { segments, total };
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

/** キュー i の姿勢。開始後 BLEND_IN の間は前のキュー(自身のブレンドを含めて再帰評価)の姿勢から寄せる */
function blended(segs: readonly CueSegment[], i: number, t: number): FullPose {
  const s = segs[i];
  const own = poseInCue(s, t);
  let p = i - 1;
  while (p >= 0 && segs[p].end <= segs[p].cue.start) p--;
  if (p < 0 || t - s.cue.start >= BLEND_IN) return own;
  const gap = s.cue.start - segs[p].end;
  if (gap < LEAD_IN || !s.gestures) return lerpFullPose(blended(segs, p, t), own, applyEase('ease-in-out', (t - s.cue.start) / BLEND_IN));
  return own;
}
export function sampleCueTimeline(ct: CueTimeline, t: number): CueSample {
  const segs = ct.segments;
  let active = -1;
  for (let i = 0; i < segs.length; i++) if (segs[i].cue.start <= t && t < segs[i].end) active = i;
  if (active >= 0) {
    const s = segs[active];
    const pose = blended(segs, active, t);
    if (!s.gestures) return { pose, cueIndex: active, gestureIndex: -1, phase: 'rest' };
    const local = (t - s.cue.start) * s.speed;
    if (local <= s.gestures.total) return { pose, cueIndex: active, gestureIndex: sampleTimeline(s.gestures, local).segmentIndex, phase: 'gesture' };
    return { pose, cueIndex: active, gestureIndex: -1, phase: 'rest' };
  }
  // 長さ 0 の区間(開始時刻が同じキューの手前側)は前後のキューとして数えない
  let prevIdx = -1;
  for (let i = 0; i < segs.length; i++) if (segs[i].cue.start <= t && segs[i].end > segs[i].cue.start) prevIdx = i;
  const base = prevIdx >= 0 ? blended(segs, prevIdx, t) : REST_POSE;
  const upcoming = segs.find((x, i) => i > prevIdx && x.cue.start > t && x.end > x.cue.start);
  const gap = upcoming && prevIdx >= 0 ? upcoming.cue.start - segs[prevIdx].end : Infinity;
  if (upcoming?.gestures && gap >= LEAD_IN && upcoming.cue.start - t < LEAD_IN) {
    const u = 1 - (upcoming.cue.start - t) / LEAD_IN;
    const first = samplePose(upcoming.gestures.segments[0].motion!, 0);
    return { pose: lerpFullPose(base, first, applyEase('ease-in-out', u)), cueIndex: -1, gestureIndex: -1, phase: 'lead-in' };
  }
  return { pose: base, cueIndex: -1, gestureIndex: -1, phase: 'idle' };
}
