// 手 1 本分の時系列(チャンネル = 手首位置 3 + 手首 euler 3 + 指の屈曲 15)に対する処理。純粋関数。
// 外れ値除去 -> 欠落補間 -> 平滑 -> トリム -> keyframe 間引き の各段をここに置く。
import { FINGER_JOINTS } from '../types/definition';
import { wrap180 } from './math';
import type { FingerJoint, HandPose, Vec3 } from '../types/definition';

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

/** 連続性を捨てる(正規形へ戻す)しきい値: 最も近い候補でも直前とのチャンネル最大差がこれ(度)を超えたら、誤検出や急な反転とみなす */
export const UNWRAP_BREAK = 60;

/** 手首 euler の周期ずれ(±180 をまたぐ)とジンバル付近の等価解をそろえる。
 *  同じ向きを表す euler は 2 つある: (x, y, z) と (x+180, 180-y, z-180)(z は motion の符号 = 橈屈。intrinsic XYZ の等価解)。
 *  y が ±90° 付近だと分解がどちらかへ飛ぶので、サンプルごとに 2 つの等価解 × 360 の倍数のうち直前の有効サンプルに最も近い候補を選ぶ。
 *  ただし最も近い候補でも直前との差が大きい(UNWRAP_BREAK 超)なら連続性を捨て、分解そのまま(正規形: x,z は ±180、y は ±90)を採る。
 *  誤検出が 2 フレーム以上続いても、以降の録画全体が等価解や ±360 ずれた表現に固定されない。
 *  最初のサンプルは分解のまま。y が 90 を超えて続いてよい(スキーマは ±360 まで)。 */
export function unwrapRotation(samples: readonly Sample[]): Sample[] {
  let prev: number[] | null = null;
  const align = (v: number[], p: number[]): number[] => {
    const o = v.slice();
    for (const c of ROT) o[c] += 360 * Math.round((p[c] - o[c]) / 360);
    return o;
  };
  const dist = (v: number[], p: number[]): number => Math.max(...ROT.map((c) => Math.abs(v[c] - p[c])));
  return samples.map((s) => {
    if (!s.v) return s;
    let v = s.v.slice();
    if (prev) {
      const alt = v.slice();
      alt[3] = v[3] + 180;
      alt[4] = 180 - v[4];
      alt[5] = v[5] - 180;
      const a = align(v, prev);
      const b = align(alt, prev);
      const best = dist(b, prev) < dist(a, prev) ? b : a;
      if (dist(best, prev) <= UNWRAP_BREAK) v = best;
    }
    prev = v;
    return { t: s.t, v };
  });
}

/** 連続区間(欠落・300° 超の飛びで区切る)ごとに手首 euler の表現を整える。
 *  1. 区間全体に等価解の写像 (x+180, 180-y, z-180) を掛けた表現と掛けない表現のうち、y の可動域(±90°)からのはみ出しが小さい方を選ぶ
 *     (連続性を保ったまま、誤検出に引きずられて y が ±90° を超えた表現に固定されたものを正規形側へ戻す。区間全体に同じ写像を掛けるので連続性は壊れない)。
 *  2. 各チャンネルを、区間の中央値が ±180 に入るように 360 の倍数ぶん区間全体から引く。
 *  1 サンプルずつ折り返すと、区間の途中で 360 をまたいだときに keyframe 間に 360° の段差ができて補間が逆回りになるため、区間全体を同じだけずらす。 */
export function normalizeRotationRuns(samples: readonly Sample[]): Sample[] {
  const out = samples.map((s) => ({ t: s.t, v: s.v ? s.v.slice() : null }));
  const excess = (y: number): number => Math.max(0, Math.abs(wrap180(y)) - 90);
  let i = 0;
  while (i < out.length) {
    if (!out[i].v) { i++; continue; }
    let j = i + 1;
    while (j < out.length && out[j].v && ROT.every((c) => Math.abs((out[j].v as number[])[c] - (out[j - 1].v as number[])[c]) <= 300)) j++;
    const run = out.slice(i, j).map((s) => s.v as number[]);
    const plain = run.reduce((acc, v) => acc + excess(v[4]), 0);
    const flipped = run.reduce((acc, v) => acc + excess(180 - v[4]), 0);
    if (flipped < plain) for (const v of run) { v[3] += 180; v[4] = 180 - v[4]; v[5] -= 180; }
    for (const c of ROT) {
      const shift = 360 * Math.round(median(run.map((v) => v[c])) / 360);
      if (shift) for (const v of run) v[c] -= shift;
    }
    i = j;
  }
  return out;
}

const median = (xs: number[]): number => {
  const a = xs.slice().sort((x, y) => x - y);
  const n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
};

export type OutlierOptions = Readonly<{ window: number; positionThreshold: number; angleThreshold: number; /** 中央値を取るのに必要な有効値の数。これ未満の窓は判定しない */ minNeighbors?: number }>;
export const DEFAULT_OUTLIER: OutlierOptions = { window: 2, positionThreshold: 0.12, angleThreshold: 70, minNeighbors: 3 };

/** 外れ値除去(Hampel 型、チャンネル単位): 前後 window 個の中央値からしきい値を超えて外れたチャンネルだけを欠落(NaN)にする(フレーム全体は捨てない。
 *  1 つの指の不安定な角度で手首や他の指まで失わないため)。NaN は fillGaps が補間する。有効値が minNeighbors 個未満の窓は判定しない。
 *  戻り値の removed = 欠落にしたチャンネルを持つフレーム数。 */
export function removeOutliers(samples: readonly Sample[], o: OutlierOptions = DEFAULT_OUTLIER): { samples: Sample[]; removed: number } {
  let removed = 0;
  const minN = o.minNeighbors ?? 3;
  const out = samples.map((s, i) => {
    if (!s.v) return s;
    const v = s.v.slice();
    let hit = false;
    for (let c = 0; c < CHANNELS; c++) {
      const vals: number[] = [];
      for (let j = Math.max(0, i - o.window); j <= Math.min(samples.length - 1, i + o.window); j++) {
        const x = samples[j].v?.[c];
        if (x !== undefined && Number.isFinite(x)) vals.push(x);
      }
      if (vals.length < minN || !Number.isFinite(v[c])) continue;
      if (Math.abs(v[c] - median(vals)) > (isAngle(c) ? o.angleThreshold : o.positionThreshold)) {
        v[c] = NaN;
        hit = true;
      }
    }
    if (hit) removed++;
    return { t: s.t, v };
  });
  return { samples: out, removed };
}

/** チャンネル単位の欠落(NaN)を埋める: 前後に有効値があり間隔が maxGap 秒以下なら線形補間、そうでなければ直前の有効値で保持(無ければ直後、全くなければ 0) */
function fillChannels(samples: readonly Sample[], maxGap: number): Sample[] {
  const out = samples.map((s) => ({ t: s.t, v: s.v ? s.v.slice() : null }));
  for (let c = 0; c < CHANNELS; c++) {
    const valid: number[] = [];
    out.forEach((s, i) => { if (s.v && Number.isFinite(s.v[c])) valid.push(i); });
    let k = 0;
    out.forEach((s, i) => {
      if (!s.v || Number.isFinite(s.v[c])) return;
      while (k < valid.length && valid[k] < i) k++;
      const next = valid[k] as number | undefined; // valid[k] > i
      const prev = valid[k - 1] as number | undefined;
      if (prev !== undefined && next !== undefined && out[next].t - out[prev].t <= maxGap + 1e-9) {
        const u = (s.t - out[prev].t) / (out[next].t - out[prev].t);
        const a = (out[prev].v as number[])[c];
        s.v[c] = a + ((out[next].v as number[])[c] - a) * u;
      } else if (prev !== undefined) s.v[c] = (out[prev].v as number[])[c];
      else if (next !== undefined) s.v[c] = (out[next].v as number[])[c];
      else s.v[c] = 0;
    });
  }
  return out;
}

/** 欠落補間: 前後に有効サンプルがあり、その間隔が maxGap 秒以下の欠落だけ線形補間する。端(前後どちらかが無い)や長い欠落はそのまま。
 *  longGaps = 補間しなかった内部の欠落の長さ(秒) */
export function fillGaps(samples: readonly Sample[], maxGap: number): { samples: Sample[]; longGaps: number[] } {
  const out = fillChannels(samples, maxGap);
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

/** 手首 euler をスキーマの範囲(±360)へ収める(unwrap した連続な値を、範囲内なら変えない。補間が ±180 でちぎれないため) */
export function wrapRotation(v: readonly number[]): number[] {
  const out = v.slice();
  for (const c of ROT) {
    while (out[c] > 360) out[c] -= 360;
    while (out[c] < -360) out[c] += 360;
  }
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
