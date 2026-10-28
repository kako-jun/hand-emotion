// MediaPipe Hands の出力に相当する入力型と、録画設定。MediaPipe 本体には依存しない(アダプタが詰め替える)。
import type { Side } from '../types/definition';

export type Landmark = Readonly<{ x: number; y: number; z: number }>;

/** 検出された 1 つの手。landmarks = 画像座標(x,y は 0..1 の正規化)、worldLandmarks = メートル(原点は手の中心付近) */
export type DetectedHand = Readonly<{
  /** MediaPipe の handedness ラベル(そのまま。左右の解釈は resolveSide が決める) */
  label: 'Left' | 'Right';
  score?: number;
  landmarks: readonly Landmark[];
  worldLandmarks: readonly Landmark[];
}>;

export type CaptureFrame = Readonly<{ time: number; hands: readonly DetectedHand[] }>;

export type CaptureSettings = Readonly<{
  /** 映像の幅/高さ */
  aspect: number;
  /** カメラの水平画角(度) */
  fovH: number;
  /** 胸中央が写る画像上の位置(0..1) */
  chestImage: Readonly<{ x: number; y: number }>;
  /** カメラから胸中央までの距離(m) */
  chestDistance: number;
  /** 演者の腕の長さ(上腕+前腕, m)。位置を 0.6m 基準へ正規化する */
  armLength: number;
  /** 入力映像が鏡像(左右反転済み)か。生のカメラ映像なら false(既定) */
  mirroredInput: boolean;
}>;

export const REFERENCE_ARM_LENGTH = 0.6;

export const DEFAULT_SETTINGS: CaptureSettings = {
  aspect: 16 / 9,
  fovH: 60,
  chestImage: { x: 0.5, y: 0.8 },
  chestDistance: 0.7,
  armLength: REFERENCE_ARM_LENGTH,
  mirroredInput: false,
};

export type RangeWarning = Readonly<{
  kind: 'range';
  side: Side;
  joint: string;
  axis: 'x' | 'y' | 'z';
  /** 範囲外のキーフレーム数 */
  count: number;
  min: number;
  max: number;
  limit: readonly [number, number];
}>;

export type CaptureWarning =
  | RangeWarning
  /** 検出が短すぎて捨てた手(フレーム数) */
  | Readonly<{ kind: 'dropped-hand'; side: Side; frames: number }>
  /** 同じ側の手が 1 フレームに複数検出され、スコアの高い方だけ使った回数 */
  | Readonly<{ kind: 'duplicate-side'; side: Side; frames: number }>
  /** 外れ値として捨てて補間したフレーム数 */
  | Readonly<{ kind: 'outliers'; side: Side; frames: number }>
  /** 長い欠落(補間しなかった区間) */
  | Readonly<{ kind: 'long-gap'; side: Side; seconds: number }>;
