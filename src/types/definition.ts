// 定義データ(不変): プリセット motion と avatar profile。実行時に書き換えない。
// 再生状態(可変)は playback.ts に分離する。

export const FINGER_JOINTS = [
  'thumbCmc', 'thumbMcp', 'thumbIp',
  'indexMcp', 'indexPip', 'indexDip',
  'middleMcp', 'middlePip', 'middleDip',
  'ringMcp', 'ringPip', 'ringDip',
  'littleMcp', 'littlePip', 'littleDip',
] as const;

export type FingerJoint = (typeof FINGER_JOINTS)[number];
export type Side = 'left' | 'right';
/** euler 回転(度) [x, y, z] */
export type Vec3 = readonly [number, number, number];

/** 言語区分。混同させない: JSL / かな指文字 / 手話風身振り */
export type MotionCategory = 'jsl' | 'kana-fingerspelling' | 'sign-like-gesture';
export type Ease = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export type Provenance = Readonly<{
  status: 'unreviewed' | 'reviewed';
  reviewer?: string;
  reviewedAt?: string;
  source?: string;
}>;

export type HandPose = Readonly<{
  wrist: Readonly<{ position: Vec3; rotation: Vec3 }>;
  joints: Readonly<Record<FingerJoint, Vec3>>;
  arm?: Readonly<{ shoulder?: Vec3; elbow?: Vec3 }>;
}>;

export type Pose = Readonly<Partial<Record<Side, HandPose>>>;

export type Keyframe = Readonly<{ time: number; ease?: Ease; hold?: number; pose: Pose }>;

export type MotionDefinition = Readonly<{
  schemaVersion: '0.1.0';
  id: string;
  category: MotionCategory;
  provenance: Provenance;
  semantic: Readonly<{ label: string; reading?: string; gloss?: string; lang?: string }>;
  duration: number;
  keyframes: readonly Keyframe[];
}>;

export type AxisRange = Readonly<{
  x?: readonly [number, number];
  y?: readonly [number, number];
  z?: readonly [number, number];
}>;

export type SideBones = Readonly<{
  wrist: string;
  shoulder?: string;
  elbow?: string;
  fingers?: Readonly<Partial<Record<FingerJoint, string>>>;
}>;

export type AvatarProfile = Readonly<{
  schemaVersion: '0.1.0';
  id: string;
  rig: 'vrm-humanoid' | 'gltf-humanoid' | 'custom';
  /** gesture-only: 指ボーン不足のため手首/腕のジェスチャのみ */
  capability: 'full' | 'gesture-only';
  bones: Readonly<{ left: SideBones; right: SideBones; face?: Readonly<Record<string, string>> }>;
  rangeOfMotion: Readonly<Record<string, AxisRange>>;
  restPoseCorrection?: Readonly<Record<string, Vec3>>;
}>;
