// capture 層の最小ベクトル/行列演算。Three.js 非依存(純粋関数)。
export type V3 = readonly [number, number, number];
/** 3x3 回転行列。列ベクトル [X, Y, Z] の並び(列 i = 軸 i のワールド座標) */
export type Mat3 = readonly [V3, V3, V3];

export const DEG = Math.PI / 180;
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
/** 長さが 1e-9 未満なら null(退化) */
export function normalize(a: V3): V3 | null {
  const l = length(a);
  return l < 1e-9 ? null : scale(a, 1 / l);
}

const at = (m: Mat3, r: number, c: number): number => m[c][r];
export const transpose = (m: Mat3): Mat3 => [
  [at(m, 0, 0), at(m, 0, 1), at(m, 0, 2)],
  [at(m, 1, 0), at(m, 1, 1), at(m, 1, 2)],
  [at(m, 2, 0), at(m, 2, 1), at(m, 2, 2)],
];
export function mul(a: Mat3, b: Mat3): Mat3 {
  const col = (c: number): V3 => {
    const v = b[c];
    return [
      at(a, 0, 0) * v[0] + at(a, 0, 1) * v[1] + at(a, 0, 2) * v[2],
      at(a, 1, 0) * v[0] + at(a, 1, 1) * v[1] + at(a, 1, 2) * v[2],
      at(a, 2, 0) * v[0] + at(a, 2, 1) * v[1] + at(a, 2, 2) * v[2],
    ];
  };
  return [col(0), col(1), col(2)];
}

const rx = (a: number): Mat3 => [[1, 0, 0], [0, Math.cos(a), Math.sin(a)], [0, -Math.sin(a), Math.cos(a)]];
const ry = (a: number): Mat3 => [[Math.cos(a), 0, -Math.sin(a)], [0, 1, 0], [Math.sin(a), 0, Math.cos(a)]];
const rz = (a: number): Mat3 => [[Math.cos(a), Math.sin(a), 0], [-Math.sin(a), Math.cos(a), 0], [0, 0, 1]];

/** euler(度)-> 回転行列。intrinsic XYZ = Rx · Ry · Rz(Three.js の Euler 'XYZ' と同じ) */
export function eulerToMat(e: V3): Mat3 {
  return mul(mul(rx(e[0] * DEG), ry(e[1] * DEG)), rz(e[2] * DEG));
}

/** 回転行列 -> euler(度, intrinsic XYZ)。Three.js の Euler.setFromRotationMatrix('XYZ') と同じ式 */
export function matToEuler(m: Mat3): V3 {
  const m13 = Math.min(1, Math.max(-1, at(m, 0, 2)));
  const y = Math.asin(m13);
  let x: number;
  let z: number;
  if (Math.abs(m13) < 0.9999999) {
    x = Math.atan2(-at(m, 1, 2), at(m, 2, 2));
    z = Math.atan2(-at(m, 0, 1), at(m, 0, 0));
  } else {
    x = Math.atan2(at(m, 2, 1), at(m, 1, 1));
    z = 0;
  }
  return [x / DEG, y / DEG, z / DEG];
}

/** 角度(度)を (-180, 180] へ */
export function wrap180(d: number): number {
  const w = ((((d + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}
