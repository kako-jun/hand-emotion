import type { MotionDefinition, Pose } from './definition';

// 再生状態(可変)。定義(MotionDefinition)への参照を持つだけで、定義側へ書き戻さない。
export type PlaybackState = {
  motion: MotionDefinition;
  /** 現在の再生位置(秒) */
  time: number;
  playing: boolean;
  /** 現在適用中のポーズ(補間結果) */
  currentPose: Pose | null;
  /** retarget 時の fallback 判定結果 */
  fallback: 'none' | 'gesture-only';
};

export function createPlaybackState(motion: MotionDefinition): PlaybackState {
  return { motion, time: 0, playing: false, currentPose: null, fallback: 'none' };
}
