// retarget: 中間表現 motion(の姿勢)+ avatar profile → 対象骨格のポーズ。
// Three.js / DOM に依存しない純粋関数。描画側はこの結果を適用するだけ。
// 規約(docs/spec.md): 左手は右手規約で書かれた値を鏡像変換して適用する(位置 x と回転 y・z の符号反転)。
//   可動域は右手基準で clamp してから鏡像にする(左手にも同じ値を使うため)。
import { FINGER_JOINTS } from '../types/definition';
import type { AvatarProfile, AxisRange, FingerJoint, HandPose, Keyframe, MotionDefinition, Side, Vec3 } from '../types/definition';

export type BoneHandPose = Readonly<{
  /** 演者の胸中央基準の手首位置(meter)。左手は鏡像変換済みの実座標 */
  wristPosition: Vec3;
  /** profile のボーン名 -> 回転(度, euler XYZ intrinsic)。左手は鏡像変換・初期姿勢補正済み */
  bones: Readonly<Record<string, Vec3>>;
}>;

export type RetargetedPose = Readonly<{
  left: BoneHandPose;
  right: BoneHandPose;
  /** 'gesture-only': 指ボーン不足のため指の回転を出力しない(手首/腕のみ) */
  fallback: 'none' | 'gesture-only';
  /** 可動域で丸めた箇所 `${side}/${joint}/${axis}` */
  clamped: readonly string[];
}>;

export type RetargetedKeyframe = Readonly<{ time: number; ease?: Keyframe['ease']; hold?: number; pose: Partial<Record<Side, BoneHandPose>> }>;

export type RetargetedMotion = Readonly<{
  motionId: string;
  profileId: string;
  fallback: 'none' | 'gesture-only';
  keyframes: readonly RetargetedKeyframe[];
  clamped: readonly string[];
}>;

const neg = (v: number): number => (v === 0 ? 0 : -v);
/** 左手用の位置鏡像: x を反転 */
export const mirrorPosition = (p: Vec3): Vec3 => [neg(p[0]), p[1], p[2]];
/** 左手用の回転鏡像: y・z を反転 */
export const mirrorRotation = (r: Vec3): Vec3 => [r[0], neg(r[1]), neg(r[2])];

const AXES = ['x', 'y', 'z'] as const;

function clampRotation(rot: Vec3, range: AxisRange | undefined, label: string, clamped: string[]): Vec3 {
  if (!range) return rot;
  const out: [number, number, number] = [rot[0], rot[1], rot[2]];
  AXES.forEach((axis, i) => {
    const r = range[axis];
    if (!r) return;
    const v = Math.min(r[1], Math.max(r[0], out[i]));
    if (v !== out[i]) {
      clamped.push(`${label}/${axis}`);
      out[i] = v;
    }
  });
  return out;
}

/** 指ボーンが足りない profile は gesture-only として扱う(capability 宣言 or 実際の欠損) */
export function isGestureOnly(profile: AvatarProfile): boolean {
  if (profile.capability === 'gesture-only') return true;
  return (['left', 'right'] as const).some((s) => {
    const f = profile.bones[s].fingers;
    return !f || FINGER_JOINTS.some((j) => !f[j]);
  });
}

function retargetHand(hand: HandPose, side: Side, profile: AvatarProfile, gestureOnly: boolean, clamped: string[]): BoneHandPose {
  const bones: Record<string, Vec3> = {};
  const sideBones = profile.bones[side];
  const rom = profile.rangeOfMotion;
  const correction = profile.restPoseCorrection ?? {};
  const put = (boneName: string | undefined, joint: string, rot: Vec3, range: AxisRange | undefined): void => {
    if (!boneName) return;
    const c = clampRotation(rot, range, `${side}/${joint}`, clamped);
    const m = side === 'left' ? mirrorRotation(c) : c;
    const off = correction[boneName];
    bones[boneName] = off ? [m[0] + off[0], m[1] + off[1], m[2] + off[2]] : m;
  };
  put(sideBones.wrist, 'wrist', hand.wrist.rotation, rom.wrist);
  if (hand.arm?.shoulder) put(sideBones.shoulder, 'shoulder', hand.arm.shoulder, rom.shoulder);
  if (hand.arm?.elbow) put(sideBones.elbow, 'elbow', hand.arm.elbow, rom.elbow);
  if (!gestureOnly) {
    for (const j of FINGER_JOINTS as readonly FingerJoint[]) put(sideBones.fingers?.[j], j, hand.joints[j], rom[j]);
  }
  return { wristPosition: side === 'left' ? mirrorPosition(hand.wrist.position) : hand.wrist.position, bones };
}

/** 1時点の姿勢(両手揃い)を対象骨格のポーズへ。 */
export function retargetPose(pose: Readonly<{ left: HandPose; right: HandPose }>, profile: AvatarProfile): RetargetedPose {
  const gestureOnly = isGestureOnly(profile);
  const clamped: string[] = [];
  return {
    left: retargetHand(pose.left, 'left', profile, gestureOnly, clamped),
    right: retargetHand(pose.right, 'right', profile, gestureOnly, clamped),
    fallback: gestureOnly ? 'gesture-only' : 'none',
    clamped,
  };
}

/** motion の各キーフレームを対象骨格のポーズ列へ(timing はそのまま引き継ぐ)。 */
export function retargetMotion(motion: MotionDefinition, profile: AvatarProfile): RetargetedMotion {
  const gestureOnly = isGestureOnly(profile);
  const clamped: string[] = [];
  const keyframes = motion.keyframes.map((k): RetargetedKeyframe => {
    const pose: Partial<Record<Side, BoneHandPose>> = {};
    for (const side of ['left', 'right'] as const) {
      const hand = k.pose[side];
      if (hand) pose[side] = retargetHand(hand, side, profile, gestureOnly, clamped);
    }
    return { time: k.time, ...(k.ease ? { ease: k.ease } : {}), ...(k.hold ? { hold: k.hold } : {}), pose };
  });
  return { motionId: motion.id, profileId: profile.id, fallback: gestureOnly ? 'gesture-only' : 'none', keyframes, clamped };
}
