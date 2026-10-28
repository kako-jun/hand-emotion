// キュー列(字幕時刻)に身振り列を載せるタイムライン。純粋関数。方針は docs/spec.md「字幕時刻との同期」。
//  - 各キューの区間 [start, end) に、そのキューの身振り列を収める。end は次キューの start で打ち切る。
//  - 身振り列が区間より長いとき: 速度を上げて収める。ただし上限 MAX_SPEED 倍まで。それでも収まらない末尾の身振りは省略し、字幕のみにする。
//  - 短いとき: 身振りの後は待機姿勢へ戻して区間の終わりまで待つ(引き伸ばさない)。
import type { Cue } from '../import/cues';
import type { SequenceItem } from '../text/vocabulary';
import { lerpFullPose, samplePose } from './interpolate';
import type { FullPose } from './interpolate';
import { REST_POSE } from './rest';
import { TRANSITION, buildTimeline, sampleTimeline } from './timeline';
import type { Timeline } from './timeline';

/** 身振りの再生速度の上限(倍) */
export const MAX_SPEED = 1.5;
/** キュー開始前に待機姿勢から先頭姿勢へ寄せる時間(秒)。身振り本体の開始時刻は動かさない */
export const LEAD_IN = 0.3;
/** 身振りが終わってから待機姿勢へ戻る時間(秒) */
export const RETURN_TO_REST = TRANSITION;

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

export function sampleCueTimeline(ct: CueTimeline, t: number): CueSample {
  const segs = ct.segments;
  // 区間内: 開始が最も遅いキュー(重なりは後勝ち)
  let active = -1;
  for (let i = 0; i < segs.length; i++) if (segs[i].cue.start <= t && t < segs[i].end) active = i;
  if (active >= 0) {
    const s = segs[active];
    if (!s.gestures) return { pose: REST_POSE, cueIndex: active, gestureIndex: -1, phase: 'rest' };
    const local = (t - s.cue.start) * s.speed;
    if (local <= s.gestures.total) {
      const g = sampleTimeline(s.gestures, local);
      return { pose: g.pose, cueIndex: active, gestureIndex: g.segmentIndex, phase: 'gesture' };
    }
    const last = sampleTimeline(s.gestures, s.gestures.total).pose;
    const u = Math.min(1, (local - s.gestures.total) / s.speed / RETURN_TO_REST);
    return { pose: u >= 1 ? REST_POSE : lerpFullPose(last, REST_POSE, u), cueIndex: active, gestureIndex: -1, phase: 'rest' };
  }
  // 区間外: 次のキューの直前なら寄せ、それ以外は待機
  const upcoming = segs.filter((s) => s.cue.start > t).sort((a, b) => a.cue.start - b.cue.start)[0];
  if (upcoming?.gestures && upcoming.cue.start - t < LEAD_IN) {
    const u = 1 - (upcoming.cue.start - t) / LEAD_IN;
    const first = samplePose(upcoming.gestures.segments[0].motion!, 0);
    return { pose: lerpFullPose(REST_POSE, first, u), cueIndex: -1, gestureIndex: -1, phase: 'lead-in' };
  }
  return { pose: REST_POSE, cueIndex: -1, gestureIndex: -1, phase: 'idle' };
}
