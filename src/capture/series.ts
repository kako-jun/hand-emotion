// 手 1 本分の時系列(チャンネル = 手首位置 3 + 手首 euler 3 + 指の屈曲 15)に対する処理。純粋関数。
// 外れ値除去 -> 欠落補間 -> 平滑 -> トリム -> keyframe 間引き の各段をここに置く。
import { FINGER_JOINTS } from '../types/definition';
import type { FingerJoint, HandPose, Vec3 } from '../types/definition';
import { wrap180 } from './math';

export const CHANNELS = 21;
const ROT = [3, 4, 5];
/** チャンネルが角度(度)か、位置(m)か */
const isAngle = (c: number): boolean => c >= 3;

/** 時刻つきの 1 サンプル。v が null なら手が検出されなかったフレーム */
export type Sample = { t: number; v: number[] | null };

export function poseToChannels(p: HandPose): number[] {
  return [...p.wrist.position, ...p.wrist.rotation, ...FINGER_JOINTS.map((j) => p.joints[j][0])];
}
export function channelsToPose(v: readonly number[]): HandPose {
  const joints = {} as Record<FingerJoint, Vec3>;
  FINGER_JOINTS.forEach((j, i) => { joints[j] = [v[6 + i], 0, 0]; });
  return { wrist: { position: [v[0], v[1], v[2]], rotation: [v[3], v[4], v[5]] }, joints };
}

/** 手首 euler の周期ずれ(±180 をまたぐ)をなくす: 直前の有効サンプルに最も近い角度へ 360 の倍数を足す */
export function unwrapRotation(samples: readonly Sample[]): Sample[] {
  let prev: number[] | null = null;
  return samples.map((s) => {
    if (!s.v) return s;
    const v = s.v.slice();
    if (prev) for (const c of ROT) v[c] += 360 * Math.round((prev[c] - v[c]) / 360);
    prev = v;
    return { t: s.t, v };
  });
}

const median = (xs: number[]): number => {
  const a = xs.slice().sort((x, y) => x - y);
  const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
};

export type OutlierOptions = Readonly<{ window: number; positionThreshold: number; angleThreshold: number }>;
export const DEFAULT_OUTLIER: OutlierOptions = { window: 2, positionThreshold: 0.12, angleThreshold: 70 };

/** 外れ値除去(Hampel 型): 前後 window 個の有効サンプルの中央値からしきい値を超えて外れたら、そのフレームを丸ごと欠落(null)にする。
 *  戻り値の removed = 欠落にしたフレーム数。有効サンプルが 3 個未満の窓は判定しない。 */
export function removeOutliers(samples: readonly Sample[], o: OutlierOptions = DEFAULT_OUTLIER): { samples: Sample[]; removed: number } {
  let removed = 0;
  const out = samples.map((s, i) => {
    if (!s.v) return s;
    const neighbors: number[][] = [];
    for (let j = Math.max(0, i - o.window); j <= Math.min(samples.length - 1, i + o.window); j++) {
      const v = samples[j].v;
      if (v) neighbors.push(v);
    }
    if (neighbors.length < 3) return s;
    for (let c = 0; c < CHANNELS; c++) {
      const m = median(neighbors.map((v) => v[c]));
      if (Math.abs(s.v[c] - m) > (isAngle(c) ? o.angleThreshold : o.positionThreshold)) {
        removed++;
        return { t: s.t, v: null };
      }
    }
    return s;
  });
  return { samples: out, removed };
}

/** 欠落補間: 前後に有効サンプルがあり、その間隔が maxGap 秒以下の欠落だけ線形補間する。端(前後どちらかが無い)や長い欠落はそのまま。
 *  longGaps = 補間しなかった内部の欠落の長さ(秒) */
export function fillGaps(samples: readonly Sample[], maxGap: number): { samples: Sample[]; longGaps: number[] } {
  const out = samples.map((s) => ({ t: s.t, v: s.v ? s.v.slice() : null }));
  const longGaps: number[] = [];
  let i = 0;
  while (i < out.length) {
    if (out[i].v) { i++; continue; }
    let j = i;
    while (j < out.length && !out[j].v) j++;
    // 欠落は [i, j)。前 = i-1、後 = j
    if (i > 0 && j < out.length) {
      const a = out[i - 1];
      const b = out[j];
      const gap = b.t - a.t;
      if (gap <= maxGap + 1e-9) {
        for (let k = i; k < j; k++) {
          const u = (out[k].t - a.t) / gap;
          out[k].v = (a.v as number[]).map((x, c) => x + ((b.v as number[])[c] - x) * u);
        }
      } else {
        longGaps.push(gap);
      }
    }
    i = j;
  }
  return { samples: out, longGaps };
}

/** ローパス平滑(零位相): 1 次の指数平滑を前向き・後ろ向きに掛ける。欠落(null)をまたがない。cutoffHz <= 0 なら何もしない */
export function smooth(samples: readonly Sample[], cutoffHz: number): Sample[] {
  const out = samples.map((s) => ({ t: s.t, v: s.v ? s.v.slice() : null }));
  if (cutoffHz <= 0) return out;
  const pass = (idx: number[]): void => {
    let prev: number[] | null = null;
    let prevT = 0;
    for (const i of idx) {
      const v = out[i].v as number[];
      if (prev) {
        const dt = Math.abs(out[i].t - prevT);
        const a = 1 - Math.exp(-2 * Math.PI * cutoffHz * dt);
        for (let c = 0; c < CHANNELS; c++) v[c] = prev[c] + a * (v[c] - prev[c]);
      }
      prev = v;
      prevT = out[i].t;
    }
  };
  let i = 0;
  while (i < out.length) {
    if (!out[i].v) { i++; continue; }
    let j = i;
    while (j < out.length && out[j].v) j++;
    const run = Array.from({ length: j - i }, (_, k) => i + k);
    pass(run);
    pass(run.slice().reverse());
    i = j;
  }
  return out;
}

/** 区間 [start, end] のサンプルだけを残す(時刻はそのまま) */
export const trimSamples = (samples: readonly Sample[], start: number, end: number): Sample[] => samples.filter((s) => s.t >= start - 1e-9 && s.t <= end + 1e-9);

/** 手首 euler を (-180, 180] へ戻す(unwrap した後の出力用) */
export function wrapRotation(v: readonly number[]): number[] {
  const out = v.slice();
  for (const c of ROT) out[c] = wrap180(out[c]);
  return out;
}

export type DecimateOptions = Readonly<{ positionTolerance: number; angleTolerance: number }>;
export const DEFAULT_DECIMATE: DecimateOptions = { positionTolerance: 0.01, angleTolerance: 4 };

/** keyframe 間引き(Ramer-Douglas-Peucker): 残した前後の keyframe の線形補間と元サンプルの差が、全チャンネルで許容誤差以下になるように残す。
 *  連続する有効サンプルの区間ごとに、両端は必ず残す。戻り値は残すサンプルの添字(昇順)。 */
export function decimate(samples: readonly Sample[], o: DecimateOptions = DEFAULT_DECIMATE): number[] {
  const keep = new Set<number>();
  const err = (a: number, b: number, k: number): number => {
    const va = samples[a].v as number[];
    const vb = samples[b].v as number[];
    const vk = samples[k].v as number[];
    const u = samples[b].t === samples[a].t ? 0 : (samples[k].t - samples[a].t) / (samples[b].t - samples[a].t);
    let worst = 0;
    for (let c = 0; c < CHANNELS; c++) {
      const e = Math.abs(vk[c] - (va[c] + (vb[c] - va[c]) * u)) / (isAngle(c) ? o.angleTolerance : o.positionTolerance);
      if (e > worst) worst = e;
    }
    return worst;
  };
  const recurse = (a: number, b: number): void => {
    let worst = 1;
    let at = -1;
    for (let k = a + 1; k < b; k++) {
      const e = err(a, b, k);
      if (e > worst) { worst = e; at = k; }
    }
    if (at < 0) return;
    keep.add(at);
    recurse(a, at);
    recurse(at, b);
  };
  let i = 0;
  while (i < samples.length) {
    if (!samples[i].v) { i++; continue; }
    let j = i;
    while (j < samples.length && samples[j].v) j++;
    keep.add(i);
    keep.add(j - 1);
    recurse(i, j - 1);
    i = j;
  }
  return [...keep].sort((x, y) => x - y);
}
