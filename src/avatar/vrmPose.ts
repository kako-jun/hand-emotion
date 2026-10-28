// retarget の出力(演者座標・ボーン名 -> euler)-> VRM normalized humanoid ボーンのローカル quaternion。
// DOM / シーン非依存の純粋関数(Three.js の数学クラスだけ使う)。適用層(src/preview/vrmAvatar.ts)はこの結果を書くだけ。
// 規約は docs/spec.md「VRM への適用規約」。要点:
//  - VRM 1.0 は +Z が正面、キャラクターの left が +X。演者座標(+x = 演者の右)とは x が逆: 位置 x_vrm = -x_演者。
//  - normalized humanoid は T-pose(全ボーンの rest 回転が単位、ローカル軸 = ワールド軸)。
//  - euler(度, intrinsic XYZ)の軸は解剖学で定義する(x = 屈曲 / y = ひねり(回内が正) / z = 橈屈)。
//    VRM の軸への写像は手ごとの基底 B(右手 B_R、左手 B_L = M B_R M)で、q = B · E(x, y, -z) · B⁻¹。
//    (基底を右手系の回転にするために橈屈の符号を反転する。)
//  - 手首の euler は「前腕の延長を基準にした手の向き」: 基準は 指 = 前腕方向、手のひら = 前方寄り(下寄り)。
//    手の向きはワールドで決め、前腕の IK 回転を打ち消してから手首ボーンへ書く(手のひら向き優先)。
//  - 腕は手首位置への 2 ボーン IK(肘は下・外・後ろ寄りに曲がる)。胸中央 = 両 upperArm の中点の 0.15m(×scale)下。
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { RetargetedPose } from '../retarget';
import type { AvatarProfile, Side, Vec3 } from '../types/definition';

const DEG = Math.PI / 180;

/** 演者(基準体型)の腕の長さ(上腕+前腕)。avatar の腕の長さとの比で位置を scale する */
export const REF_ARM_LENGTH = 0.6;
/** 胸中央(胸骨)から肩関節までの高さ(基準体型) */
export const CHEST_TO_SHOULDER = 0.15;
/** 「まっすぐな手」の手のひら法線の基準(前・下寄り 45°)。前腕方向に直交する成分を取る */
const PALM_REF = new Vector3(0, -1, 1).normalize();
/** 肘の曲がる向きの目安(外側は左右で符号を変える) */
const POLE = (side: Side): Vector3 => new Vector3(side === 'left' ? 0.3 : -0.3, -1, -0.4);

export type Quat = readonly [number, number, number, number]; // x, y, z, w
export type ArmRest = Readonly<{ shoulder: Vec3; elbow: Vec3; wrist: Vec3 }>;
/** normalized humanoid の T-pose 時のボーン位置から作る、IK に必要な静的情報 */
export type RestRig = Readonly<{ chest: Vec3; scale: number; arms: Readonly<Record<Side, ArmRest | null>> }>;

export type VrmBonePose = Readonly<{
  /** VRM ボーン名 -> ローカル quaternion */
  bones: Readonly<Record<string, Quat>>;
  /** IK で手首が届かず、腕を伸ばしきった手 */
  unreachable: readonly Side[];
}>;

const v3 = (a: Vec3): Vector3 => new Vector3(a[0], a[1], a[2]);
const toQuat = (q: Quaternion): Quat => [q.x, q.y, q.z, q.w];

// --- 手ごとの基底(T-pose の手の軸 -> VRM ワールド軸) ---
// 右手: X' = +z(屈曲の軸)、Y' = -x(指の長軸)、Z' = -y(手のひら法線 = 下)。左手は x を鏡像にした M B_R M。
const MIRROR = new Matrix4().makeScale(-1, 1, 1);
const B_RIGHT = new Matrix4().makeBasis(new Vector3(0, 0, 1), new Vector3(-1, 0, 0), new Vector3(0, -1, 0));
const B_LEFT = new Matrix4().multiplyMatrices(MIRROR, B_RIGHT).multiply(MIRROR);
export const handBasis = (side: Side): Matrix4 => (side === 'left' ? B_LEFT : B_RIGHT).clone();
const quatOf = (m: Matrix4): Quaternion => new Quaternion().setFromRotationMatrix(m);

/** euler(度, 手ごとの規約の値)-> 基底軸まわりの回転 E(x, y, -z)。橈屈 z の符号は基底を右手系にするための反転 */
function eulerQuat(e: Vec3): Quaternion {
  return new Quaternion().setFromEuler(new Euler(e[0] * DEG, e[1] * DEG, -e[2] * DEG, 'XYZ'));
}

/** 指・肩・肘など「親のローカル軸が T-pose のまま」のボーン: q = B · E · B⁻¹ */
export function boneQuat(e: Vec3, side: Side): Quat {
  const b = quatOf(handBasis(side));
  return toQuat(b.clone().multiply(eulerQuat(e)).multiply(b.clone().invert()));
}

/** 前腕方向 u(肘 -> 手首、単位ベクトル)から手の基準フレーム(列 = 手の軸 X', Y', Z')。euler 0 の手の向き */
export function handReferenceFrame(u: Vector3, side: Side): Matrix4 {
  const frameRight = (dir: Vector3): Matrix4 => {
    const p = PALM_REF.clone().addScaledVector(dir, -PALM_REF.dot(dir));
    if (p.lengthSq() < 1e-8) p.set(0, 0, 1);
    p.normalize();
    const t = new Vector3().crossVectors(dir, p);
    return new Matrix4().makeBasis(t, dir, p);
  };
  if (side === 'right') return frameRight(u);
  const mirrored = u.clone().multiply(new Vector3(-1, 1, 1));
  return new Matrix4().multiplyMatrices(MIRROR, frameRight(mirrored)).multiply(MIRROR);
}

// --- 腕の IK ---
type ArmSolution = Readonly<{ upper: Quaternion; lowerLocal: Quaternion; lowerWorld: Quaternion; forearm: Vector3; reachable: boolean }>;

function solveArm(side: Side, target: Vector3, rest: ArmRest): ArmSolution {
  const sh = v3(rest.shoulder);
  const dUp0 = v3(rest.elbow).sub(sh);
  const dLow0 = v3(rest.wrist).sub(v3(rest.elbow));
  const l1 = dUp0.length();
  const l2 = dLow0.length();
  const v = target.clone().sub(sh);
  const maxReach = (l1 + l2) * 0.9995;
  const minReach = Math.abs(l1 - l2) + 1e-4;
  const raw = v.length();
  const d = Math.min(maxReach, Math.max(minReach, raw));
  const dir = raw > 1e-9 ? v.clone().divideScalar(raw) : new Vector3(0, -1, 0);
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  const a = Math.acos(cosA);
  const pole = POLE(side);
  const perp = pole.addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-8) perp.set(0, 0, -1);
  perp.normalize();
  const elbowDir = dir.clone().multiplyScalar(Math.cos(a)).addScaledVector(perp, Math.sin(a)).normalize();
  const elbow = sh.clone().addScaledVector(elbowDir, l1);
  const wrist = sh.clone().addScaledVector(dir, d);
  const forearm = wrist.sub(elbow).normalize();
  const upper = new Quaternion().setFromUnitVectors(dUp0.clone().normalize(), elbowDir);
  const lowerWorld = new Quaternion().setFromUnitVectors(dLow0.clone().normalize().applyQuaternion(upper), forearm).multiply(upper);
  const lowerLocal = upper.clone().invert().multiply(lowerWorld);
  return { upper, lowerLocal, lowerWorld, forearm, reachable: raw <= maxReach && raw >= minReach };
}

/** T-pose 時のボーン位置(VRM モデル空間)から RestRig を作る。肩・肘・手首が揃わない側は arms[side] = null(IK なし) */
export function buildRestRig(positions: Readonly<Record<string, Vec3 | undefined>>, profile: AvatarProfile): RestRig {
  const arms = { left: null, right: null } as Record<Side, ArmRest | null>;
  let lenSum = 0;
  let lenCount = 0;
  for (const side of ['left', 'right'] as const) {
    const b = profile.bones[side];
    const shoulder = b.shoulder && positions[b.shoulder];
    const elbow = b.elbow && positions[b.elbow];
    const wrist = positions[b.wrist];
    if (shoulder && elbow && wrist) {
      arms[side] = { shoulder, elbow, wrist };
      lenSum += v3(elbow).distanceTo(v3(shoulder)) + v3(wrist).distanceTo(v3(elbow));
      lenCount++;
    }
  }
  const scale = lenCount ? lenSum / lenCount / REF_ARM_LENGTH : 1;
  const l = arms.left;
  const r = arms.right;
  const mid: Vec3 = l && r ? [(l.shoulder[0] + r.shoulder[0]) / 2, (l.shoulder[1] + r.shoulder[1]) / 2, (l.shoulder[2] + r.shoulder[2]) / 2] : l ? [0, l.shoulder[1], l.shoulder[2]] : r ? [0, r.shoulder[1], r.shoulder[2]] : [0, 1.2, 0];
  return { chest: [mid[0], mid[1] - CHEST_TO_SHOULDER * scale, mid[2]], scale, arms };
}

/** 演者座標の手首位置(meter)-> VRM モデル空間。x は反転、胸中央基準、avatar の腕の長さで scale */
export function wristTarget(pos: Vec3, rig: RestRig): Vector3 {
  return new Vector3(rig.chest[0] - pos[0] * rig.scale, rig.chest[1] + pos[1] * rig.scale, rig.chest[2] + pos[2] * rig.scale);
}

/** retarget の 1 時点の出力 -> VRM ボーンのローカル quaternion */
export function toVrmPose(pose: RetargetedPose, profile: AvatarProfile, rig: RestRig): VrmBonePose {
  const bones: Record<string, Quat> = {};
  const unreachable: Side[] = [];
  for (const side of ['left', 'right'] as const) {
    const hand = pose[side];
    const names = profile.bones[side];
    const arm = rig.arms[side];
    let parentWorld = new Quaternion();
    let forearm = new Vector3(side === 'left' ? 1 : -1, 0, 0);
    if (arm) {
      const sol = solveArm(side, wristTarget(hand.wristPosition, rig), arm);
      if (!sol.reachable) unreachable.push(side);
      // 明示された肩/肘の回転(motion の arm)は IK 結果の上に加える追加の回転
      const off = (bone: string | undefined): Quaternion => {
        const e = bone ? hand.bones[bone] : undefined;
        if (!e) return new Quaternion();
        const b = quatOf(handBasis(side));
        return b.clone().multiply(eulerQuat(e)).multiply(b.clone().invert());
      };
      const upper = sol.upper.clone().multiply(off(names.shoulder));
      const lowerLocal = sol.lowerLocal.clone().multiply(off(names.elbow));
      if (names.shoulder) bones[names.shoulder] = toQuat(upper);
      if (names.elbow) bones[names.elbow] = toQuat(lowerLocal);
      parentWorld = upper.clone().multiply(lowerLocal);
      forearm = sol.forearm;
    }
    const wristEuler = hand.bones[names.wrist] ?? ([0, 0, 0] as const);
    const orientation = quatOf(handReferenceFrame(forearm, side)).multiply(eulerQuat(wristEuler));
    const world = orientation.multiply(quatOf(handBasis(side)).invert());
    bones[names.wrist] = toQuat(parentWorld.clone().invert().multiply(world));
    for (const bone of Object.values(names.fingers ?? {})) {
      const e = bone && hand.bones[bone];
      if (e) bones[bone] = boneQuat(e, side);
    }
  }
  return { bones, unreachable };
}
