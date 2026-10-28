// keyframe 補間・ease・hold。Three.js / DOM 非依存の純粋関数。
// 規約: keyframe の ease / hold は「そのキーフレームから次のキーフレームへ向かう区間」に掛かる。
//   time 〜 time+hold はそのポーズを保持し、time+hold 〜 次の time を ease で補間する。
//   最初より前・最後より後は端のポーズを保持する(最後のキーフレームの ease は使われない)。
import { FINGER_JOINTS } from '../types/definition';
import type { Ease, FingerJoint, HandPose, Keyframe, MotionDefinition, Vec3 } from '../types/definition';
import { REST_POSE } from './rest';

/** 左右とも揃った姿勢(補間結果。片手しか指定がない motion の反対側は待機姿勢) */
export type FullPose = Readonly<{ left: HandPose; right: HandPose }>;

/** 0..1 の進行度に ease を掛ける。 */
export function applyEase(ease: Ease | undefined, t: number): number {
  const u = Math.min(1, Math.max(0, t));
  switch (ease) {
    case 'ease-in':
      return u * u;
    case 'ease-out':
      return 1 - (1 - u) * (1 - u);
    case 'ease-in-out':
      return u < 0.5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2;
    default:
      return u;
  }
}

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
export const lerpVec3 = (a: Vec3, b: Vec3, u: number): Vec3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];

function lerpArm(a: HandPose['arm'], b: HandPose['arm'], u: number): HandPose['arm'] {
  if (!a) return b;
  if (!b) return a;
  const pick = (x: Vec3 | undefined, y: Vec3 | undefined): Vec3 | undefined => (x && y ? lerpVec3(x, y, u) : (x ?? y));
  const shoulder = pick(a.shoulder, b.shoulder);
  const elbow = pick(a.elbow, b.elbow);
  return { ...(shoulder ? { shoulder } : {}), ...(elbow ? { elbow } : {}) };
}

export function lerpHandPose(a: HandPose, b: HandPose, u: number): HandPose {
  const joints = {} as Record<FingerJoint, Vec3>;
  for (const j of FINGER_JOINTS) joints[j] = lerpVec3(a.joints[j], b.joints[j], u);
  const arm = lerpArm(a.arm, b.arm, u);
  return {
    wrist: { position: lerpVec3(a.wrist.position, b.wrist.position, u), rotation: lerpVec3(a.wrist.rotation, b.wrist.rotation, u) },
    joints,
    ...(arm ? { arm } : {}),
  };
}

export function lerpFullPose(a: FullPose, b: FullPose, u: number): FullPose {
  return { left: lerpHandPose(a.left, b.left, u), right: lerpHandPose(a.right, b.right, u) };
}

/** 片手分のキーフレーム列(その手の指定があるものだけ)を時刻 t で評価する。 */
export function sampleTrack(track: readonly { kf: Keyframe; hand: HandPose }[], t: number): HandPose | undefined {
  if (track.length === 0) return undefined;
  if (t <= track[0].kf.time) return track[0].hand;
  for (let i = 0; i < track.length - 1; i++) {
    const cur = track[i];
    const next = track[i + 1];
    if (t >= next.kf.time) continue;
    const holdEnd = Math.min(cur.kf.time + (cur.kf.hold ?? 0), next.kf.time);
    if (t <= holdEnd) return cur.hand;
    const u = (t - holdEnd) / (next.kf.time - holdEnd);
    return lerpHandPose(cur.hand, next.hand, applyEase(cur.kf.ease, u));
  }
  return track[track.length - 1].hand;
}

/** motion を時刻 t(秒)で評価する。指定のない手は待機姿勢。 */
export function samplePose(motion: MotionDefinition, t: number): FullPose {
  const track = (side: 'left' | 'right') =>
    motion.keyframes.flatMap((kf) => {
      const hand = kf.pose[side];
      return hand ? [{ kf, hand }] : [];
    });
  return {
    left: sampleTrack(track('left'), t) ?? REST_POSE.left,
    right: sampleTrack(track('right'), t) ?? REST_POSE.right,
  };
}
