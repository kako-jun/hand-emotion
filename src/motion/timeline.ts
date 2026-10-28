// 語彙列(プリセット列)を1本のタイムラインに並べ、時刻 t の姿勢を返す。純粋関数。
import type { MotionDefinition } from '../types/definition';
import type { SequenceItem } from '../text/vocabulary';
import { applyEase, lerpFullPose, samplePose } from './interpolate';
import type { FullPose } from './interpolate';
import { REST_POSE } from './rest';

/** 語と語の間の遷移(秒) */
export const TRANSITION = 0.4;
/** 未知語(無動作)の表示時間(秒) */
export const UNKNOWN_DURATION = 1.0;

export type Segment = Readonly<{
  token: string;
  /** 未知語は undefined(無動作・字幕のみ) */
  motion?: MotionDefinition;
  start: number;
  end: number;
}>;

export type Timeline = Readonly<{ segments: readonly Segment[]; total: number }>;

export function buildTimeline(items: readonly SequenceItem[], transition: number = TRANSITION): Timeline {
  const segments: Segment[] = [];
  let t = 0;
  items.forEach((item, i) => {
    if (i > 0) t += transition;
    const dur = item.kind === 'motion' ? item.motion.duration : UNKNOWN_DURATION;
    segments.push({ token: item.token, ...(item.kind === 'motion' ? { motion: item.motion } : {}), start: t, end: t + dur });
    t += dur;
  });
  return { segments, total: t };
}

const startPose = (s: Segment): FullPose => (s.motion ? samplePose(s.motion, 0) : REST_POSE);
const endPose = (s: Segment): FullPose => (s.motion ? samplePose(s.motion, s.motion.duration) : REST_POSE);

export type TimelineSample = Readonly<{
  pose: FullPose;
  /** 字幕・表示に使う区間の index(遷移中は直前の区間)。区間が空なら -1 */
  segmentIndex: number;
  phase: 'idle' | 'motion' | 'transition';
}>;

export function sampleTimeline(tl: Timeline, t: number): TimelineSample {
  const segs = tl.segments;
  if (segs.length === 0) return { pose: REST_POSE, segmentIndex: -1, phase: 'idle' };
  if (t < segs[0].start) return { pose: startPose(segs[0]), segmentIndex: 0, phase: 'idle' };
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (t <= s.end) {
      const pose = s.motion ? samplePose(s.motion, t - s.start) : REST_POSE;
      return { pose, segmentIndex: i, phase: 'motion' };
    }
    const next = segs[i + 1];
    if (next && t < next.start) {
      const u = applyEase('ease-in-out', (t - s.end) / (next.start - s.end));
      return { pose: lerpFullPose(endPose(s), startPose(next), u), segmentIndex: i, phase: 'transition' };
    }
  }
  const last = segs[segs.length - 1];
  return { pose: endPose(last), segmentIndex: segs.length - 1, phase: 'idle' };
}
