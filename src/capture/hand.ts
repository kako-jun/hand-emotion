// MediaPipe の 21 ランドマーク -> 1 時点の HandPose(motion 定義の規約)。純粋関数。
//
// 座標の流れ(docs/spec.md「録画(Phase 4b)」):
//  - MediaPipe の world 座標: +x = 画像の右、+y = 下、+z = カメラから遠ざかる向き(カメラ座標)。
//  - 演者はカメラの方を向いているので、画像の右 = 演者の左。モデル座標 (x, -y, -z)(VRM と同じ右手系、+z = 演者の前方、+x = 演者の左)へ回して使う。
//    演者座標(+x = 演者の右)の x は モデル座標の x の符号反転。
//  - 左手は鏡像(モデル x を反転)して「右手と同じ規約」の値にする。motion 定義の left は右手規約の値で持つ規約(spec)。
//  - handedness: MediaPipe のラベルは入力画像が鏡像(自撮り表示)である前提。生のカメラ映像では実際の手と逆になる。
import { FINGER_JOINTS } from '../types/definition';
import type { FingerJoint, HandPose, Side, Vec3 } from '../types/definition';
import { DEG, add, cross, dot, eulerToMat, length, matToEuler, mul, normalize, scale, sub, transpose, wrap180 } from './math';
import type { Mat3, V3 } from './math';
import type { CaptureSettings, DetectedHand, Landmark } from './types';
import { REFERENCE_ARM_LENGTH } from './types';

// --- 腕の基準体型(vrmPose.ts の IK と同じ形。肩幅だけ基準値) ---
const UPPER = 0.3;
const FORE = 0.3;
const CHEST_TO_SHOULDER = 0.15;
/** 基準体型の肩関節の中心からの半幅(m)。実アバターの肩幅とは一致しないので、前腕方向の推定にだけ使う近似 */
export const SHOULDER_HALF_WIDTH = 0.18;
/** 「まっすぐな手」の手のひら法線の基準(前・下寄り 45°) */
const PALM_REF: V3 = [0, -Math.SQRT1_2, Math.SQRT1_2];
const POLE: V3 = [-0.3, -1, -0.4];

/** MediaPipe の handedness ラベルと入力が鏡像かから、演者の実際の手の側を決める。
 *  生映像(mirroredInput=false)ではラベルと実際の手が逆: 'Left' -> 演者の右手。鏡像映像ならラベルどおり。 */
export function resolveSide(label: 'Left' | 'Right', mirroredInput: boolean): Side {
  const labelSide: Side = label === 'Left' ? 'left' : 'right';
  if (mirroredInput) return labelSide;
  return labelSide === 'left' ? 'right' : 'left';
}

/** 前腕方向 u(肘 -> 手首、単位)から手の基準フレーム(列 = 手の軸 X'=橈側, Y'=指の長軸, Z'=手のひら法線)。右手規約。
 *  euler (0,0,0) の手の向き。src/avatar/vrmPose.ts の handReferenceFrame(右手)と同じ(テストで突き合わせ)。 */
export function handReferenceFrame(u: V3): Mat3 {
  let p = sub(PALM_REF, scale(u, dot(PALM_REF, u)));
  if (dot(p, p) < 1e-8) {
    const axes = ([[0, 0, 1], [1, 0, 0], [0, 1, 0]] as V3[]).map((x) => sub(x, scale(u, dot(x, u))));
    axes.sort((a, b) => dot(b, b) - dot(a, a));
    p = axes[0];
  }
  const pn = normalize(p) as V3;
  const t = cross(u, pn);
  return [t, u, pn];
}

/** 右手空間のモデル座標の手首位置 target から、基準体型の前腕方向(肘 -> 手首)を推定する(vrmPose.ts の 2 ボーン IK と同じ解き方) */
export function estimateForearm(target: V3): V3 {
  const sh: V3 = [-SHOULDER_HALF_WIDTH, CHEST_TO_SHOULDER, 0];
  const v = sub(target, sh);
  const raw = length(v);
  const maxReach = (UPPER + FORE) * 0.9995;
  const minReach = Math.abs(UPPER - FORE) + 1e-4;
  const d = Math.min(maxReach, Math.max(minReach, raw));
  const dir: V3 = raw > 1e-9 ? scale(v, 1 / raw) : [0, -1, 0];
  const cosA = Math.min(1, Math.max(-1, (UPPER * UPPER + d * d - FORE * FORE) / (2 * UPPER * d)));
  const a = Math.acos(cosA);
  let perp = sub(POLE, scale(dir, dot(POLE, dir)));
  if (dot(perp, perp) < 1e-8) perp = [0, 0, -1];
  const pn = normalize(perp) as V3;
  const elbowDir = normalize(add(scale(dir, Math.cos(a)), scale(pn, Math.sin(a)))) as V3;
  const elbow = add(sh, scale(elbowDir, UPPER));
  const wrist = add(sh, scale(dir, d));
  return normalize(sub(wrist, elbow)) as V3;
}

/** 各指の関節の並び: [ランドマーク番号 x 4](付け根 -> 指先)。母指は CMC(1) -> 指先(4) */
const FINGER_CHAINS: readonly (readonly [readonly [FingerJoint, FingerJoint, FingerJoint], readonly [number, number, number, number]])[] = [
  [['thumbCmc', 'thumbMcp', 'thumbIp'], [1, 2, 3, 4]],
  [['indexMcp', 'indexPip', 'indexDip'], [5, 6, 7, 8]],
  [['middleMcp', 'middlePip', 'middleDip'], [9, 10, 11, 12]],
  [['ringMcp', 'ringPip', 'ringDip'], [13, 14, 15, 16]],
  [['littleMcp', 'littlePip', 'littleDip'], [17, 18, 19, 20]],
];

const finite = (l: Landmark): boolean => Number.isFinite(l.x) && Number.isFinite(l.y) && Number.isFinite(l.z);
const valid21 = (ls: readonly Landmark[]): boolean => ls.length === 21 && ls.every(finite);

export type HandConversion =
  | Readonly<{ ok: true; side: Side; pose: HandPose }>
  | Readonly<{ ok: false; side: Side; reason: string }>;

/** 画像座標のランドマークから手首の位置(演者座標・右手規約・正規化前)を出す。弱透視: 手首-中指付け根の画像上の長さと world の長さの比から奥行きを出す */
function wristPosition(hand: DetectedHand, s: CaptureSettings): V3 | null {
  const img = hand.landmarks;
  const w = hand.worldLandmarks;
  const f = 0.5 / Math.tan((s.fovH * DEG) / 2); // 画像の幅を 1 とした焦点距離
  // 画像 -> 幅を 1 とした平面座標(入力が鏡像なら x を戻す)
  const plane = (l: Landmark): readonly [number, number] => [((s.mirroredInput ? 1 - l.x : l.x) - 0.5), (l.y - 0.5) / s.aspect];
  const [u0, v0] = plane(img[0]);
  const [u9, v9] = plane(img[9]);
  const span = Math.hypot(u9 - u0, v9 - v0);
  const wx = (s.mirroredInput ? -1 : 1) * (w[9].x - w[0].x);
  const worldSpan = Math.hypot(wx, w[9].y - w[0].y);
  if (span < 1e-6 || worldSpan < 1e-4) return null;
  const depth = (f * worldSpan) / span;
  // カメラ座標(+x 右, +y 下, +z 奥)の手首と胸中央
  const cam = (u: number, v: number, z: number): V3 => [(u * z) / f, (v * z) / f, z];
  const wristCam = cam(u0, v0, depth);
  const [uc, vc] = plane({ x: s.chestImage.x, y: s.chestImage.y, z: 0 });
  const chestCam = cam(uc, vc, s.chestDistance);
  const d = sub(wristCam, chestCam);
  // モデル座標(x, -y, -z)、演者座標の x はその反転: 演者の右 = 画像の左
  const model: V3 = [d[0], -d[1], -d[2]];
  const perf: V3 = [-model[0], model[1], model[2]];
  return perf;
}

/** 1 つの検出された手 -> HandPose(右手規約。左手も右手規約の値で返す)。ランドマークが不正・退化していれば ok:false */
export function handToPose(hand: DetectedHand, settings: CaptureSettings): HandConversion {
  const side = resolveSide(hand.label, settings.mirroredInput);
  const fail = (reason: string): HandConversion => ({ ok: false, side, reason });
  if (!valid21(hand.landmarks) || !valid21(hand.worldLandmarks)) return fail('ランドマークが 21 点そろっていない/数値でない');
  const posPerf = wristPosition(hand, settings);
  if (!posPerf) return fail('手の大きさから奥行きを出せない');

  // world -> モデル座標(右手系)。左手は x を反転して右手空間へ
  const flipX = side === 'left';
  const pts: V3[] = hand.worldLandmarks.map((l) => {
    const camX = settings.mirroredInput ? -l.x : l.x;
    const m: V3 = [camX, -l.y, -l.z];
    return flipX ? [-m[0], m[1], m[2]] : m;
  });
  const Y = normalize(sub(pts[9], pts[0]));
  const rad = sub(pts[5], pts[17]);
  const Zraw = Y ? cross(rad, Y) : null;
  const Z = Zraw ? normalize(Zraw) : null;
  if (!Y || !Z) return fail('手の向き(手のひらの面)を決められない');
  const X = cross(Y, Z);
  const R: Mat3 = [X, Y, Z];

  // 位置: 演者座標 -> 右手規約(左手は x 反転)-> 0.6m 基準へ正規化
  const k = REFERENCE_ARM_LENGTH / settings.armLength;
  const posRule: V3 = [flipX ? -posPerf[0] : posPerf[0], posPerf[1], posPerf[2]];
  const position: V3 = [posRule[0] * k, posRule[1] * k, posRule[2] * k];

  // 手首の euler: 基準フレーム(前腕方向から)に対する手の向き。前腕方向は右手空間のモデル座標(x_m = -x_perf)で推定
  const target: V3 = [-position[0], position[1], position[2]];
  const F = handReferenceFrame(estimateForearm(target));
  const e = matToEuler(mul(transpose(F), R));
  const rotation: Vec3 = [e[0], e[1], -e[2]];

  // 指の屈曲: 手の局所座標で、骨の向きの (Y', Z') 平面内の角度。屈曲は Y' から Z'(手のひら側)へ曲げる向きが正
  const angle = (a: V3, b: V3): number | null => {
    const d = normalize(sub(b, a));
    return d ? Math.atan2(dot(d, Z), dot(d, Y)) / DEG : null;
  };
  const joints = {} as Record<FingerJoint, Vec3>;
  for (const [names, ids] of FINGER_CHAINS) {
    const abs = [angle(pts[ids[0]], pts[ids[1]]), angle(pts[ids[1]], pts[ids[2]]), angle(pts[ids[2]], pts[ids[3]])];
    if (abs.some((a) => a === null)) return fail('指の骨の長さが 0');
    const [a0, a1, a2] = abs as number[];
    joints[names[0]] = [a0, 0, 0];
    joints[names[1]] = [wrap180(a1 - a0), 0, 0];
    joints[names[2]] = [wrap180(a2 - a1), 0, 0];
  }
  for (const j of FINGER_JOINTS) joints[j] = joints[j] ?? [0, 0, 0];
  return { ok: true, side, pose: { wrist: { position, rotation }, joints } };
}
