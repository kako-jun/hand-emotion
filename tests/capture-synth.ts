// テスト用: 解析的な手の姿勢(HandPose)-> MediaPipe 風の合成ランドマーク(順運動学)。
// 手の局所座標(右手規約: X'=橈側, Y'=指の長軸, Z'=手のひら法線)で骨格を組み、回転・位置を与えて world / 画像ランドマークにする。
import { estimateForearm, handReferenceFrame } from '../src/capture/hand';
import { DEG, add, eulerToMat, mul, sub } from '../src/capture/math';
import type { Mat3, V3 } from '../src/capture/math';
import { DEFAULT_SETTINGS, REFERENCE_ARM_LENGTH } from '../src/capture/types';
import type { CaptureSettings, DetectedHand } from '../src/capture/types';
import type { HandPose, Side } from '../src/types/definition';

// 手の局所座標での付け根位置(m)と骨の長さ。付け根 9(中指)は Y' 軸上
const BASE: Record<number, V3> = { 5: [0.03, 0.09, 0], 9: [0, 0.095, 0], 13: [-0.025, 0.088, 0], 17: [-0.05, 0.078, 0] };
const LEN = { thumb: [0.04, 0.03, 0.025], index: [0.04, 0.025, 0.02], middle: [0.045, 0.028, 0.022], ring: [0.04, 0.026, 0.02], little: [0.032, 0.02, 0.018] };
/** 開いた指の向き(Y' からの開き角, rad)。母指は橈側へ 35° 開く */
const SPREAD = { thumb: 35 * DEG, index: 6 * DEG, middle: 0, ring: -4 * DEG, little: -9 * DEG };
const THUMB_BASE: V3 = [0.025, 0.02, 0];

/** 局所座標の 21 点(手首が原点)。flex = 各関節の屈曲角(度)。屈曲は Y' から Z' へ向かう */
export function localLandmarks(flex: HandPose['joints']): V3[] {
  const pts: V3[] = new Array(21).fill([0, 0, 0]);
  const chain = (name: 'thumb' | 'index' | 'middle' | 'ring' | 'little', start: number, base: V3, js: [string, string, string]): void => {
    pts[start] = base;
    let acc = 0;
    let p = base;
    for (let i = 0; i < 3; i++) {
      acc += flex[js[i] as keyof HandPose['joints']][0] * DEG;
      const s = SPREAD[name];
      const d: V3 = [Math.sin(s), Math.cos(s) * Math.cos(acc), Math.cos(s) * Math.sin(acc)];
      p = add(p, [d[0] * LEN[name][i], d[1] * LEN[name][i], d[2] * LEN[name][i]]);
      pts[start + 1 + i] = p;
    }
  };
  chain('thumb', 1, THUMB_BASE, ['thumbCmc', 'thumbMcp', 'thumbIp']);
  chain('index', 5, BASE[5], ['indexMcp', 'indexPip', 'indexDip']);
  chain('middle', 9, BASE[9], ['middleMcp', 'middlePip', 'middleDip']);
  chain('ring', 13, BASE[13], ['ringMcp', 'ringPip', 'ringDip']);
  chain('little', 17, BASE[17], ['littleMcp', 'littlePip', 'littleDip']);
  return pts;
}

const apply = (m: Mat3, v: V3): V3 => [
  m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
  m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
  m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
];

export type SynthOptions = Readonly<{ settings?: CaptureSettings; perspective?: boolean; worldOffset?: V3 }>;

/** HandPose(motion 定義の規約。左手は右手規約の値)を、実際の演者の side の手として撮ったランドマークにする */
export function synthesizeHand(pose: HandPose, side: Side, o: SynthOptions = {}): DetectedHand {
  const s = o.settings ?? DEFAULT_SETTINGS;
  // 右手空間(モデル座標 = x が演者の左)での手首位置と手の向き
  const posRule = pose.wrist.position;
  const target: V3 = [-posRule[0], posRule[1], posRule[2]];
  const F = handReferenceFrame(estimateForearm(target));
  const e = pose.wrist.rotation;
  const R = mul(F, eulerToMat([e[0], e[1], -e[2]]));
  const local = localLandmarks(pose.joints);
  const rel: V3[] = local.map((p) => apply(R, p)); // 手首からの相対(右手空間)
  // 実際の手: 左手は x 反転
  const real: V3[] = rel.map((p) => (side === 'left' ? [-p[0], p[1], p[2]] : p));
  // 手首の実際の位置(演者座標 = 規約値 / k。左手は x 反転)
  const k = REFERENCE_ARM_LENGTH / s.armLength;
  const perf: V3 = [(side === 'left' ? -posRule[0] : posRule[0]) / k, posRule[1] / k, posRule[2] / k];
  // 演者座標 -> モデル座標(x 反転)-> カメラ座標(x, -y, -z)
  const toCam = (m: V3): V3 => [m[0], -m[1], -m[2]];
  const f = 0.5 / Math.tan((s.fovH * DEG) / 2);
  const cam = (u: number, v: number, z: number): V3 => [(u * z) / f, (v * z) / f, z];
  const chestCam = cam(s.chestImage.x - 0.5, (s.chestImage.y - 0.5) / s.aspect, s.chestDistance);
  const dCam = toCam([-perf[0], perf[1], perf[2]]);
  const wristCam = add(chestCam, dCam);
  const offsets = real.map(toCam); // カメラ座標の手首からの相対
  const centroid = offsets.reduce<V3>((a, p) => add(a, p), [0, 0, 0]).map((x) => x / 21) as unknown as V3;
  const wo = o.worldOffset ?? [0, 0, 0];
  const flipX = (x: number): number => (s.mirroredInput ? -x : x);
  const worldLandmarks = offsets.map((p) => {
    const w = sub(p, centroid);
    return { x: flipX(w[0] + wo[0]), y: w[1] + wo[1], z: w[2] + wo[2] };
  });
  const landmarks = offsets.map((p) => {
    const X = wristCam[0] + p[0];
    const Y = wristCam[1] + p[1];
    const Z = o.perspective ? wristCam[2] + p[2] : wristCam[2];
    const u = (f * X) / Z;
    const v = (f * Y) / Z;
    const xi = 0.5 + u;
    return { x: s.mirroredInput ? 1 - xi : xi, y: 0.5 + v * s.aspect, z: p[2] };
  });
  // MediaPipe のラベル: 鏡像でない映像では実際の手と逆
  const real0 = side === 'right';
  const label = (s.mirroredInput ? real0 : !real0) ? 'Right' : 'Left';
  return { label, score: 0.9, landmarks, worldLandmarks };
}
