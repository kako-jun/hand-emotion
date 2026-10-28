// 録画フレーム列 -> 既存 motion スキーマの定義データ(MotionDefinition)。純粋関数。
// category=sign-like-gesture・provenance=unreviewed 固定。利用者の録画を JSL 等と偽らない。
import type { AvatarProfile, AxisRange, FingerJoint, HandPose, Keyframe, MotionDefinition, Pose, Side } from '../types/definition';
import { validateMotion } from '../validate';
import { handToPose } from './hand';
import { DEFAULT_DECIMATE, DEFAULT_OUTLIER, channelsToPose, decimate, fillGaps, poseToChannels, removeOutliers, smooth, trimSamples, unwrapRotation, wrapRotation } from './series';
import type { DecimateOptions, OutlierOptions, Sample } from './series';
import { DEFAULT_SETTINGS } from './types';
import type { CaptureFrame, CaptureSettings, CaptureWarning, RangeWarning } from './types';

export const RECORDED_SOURCE = 'user-recorded via MediaPipe Hands; not a reviewed sign';
/** 動作として成立する最短の長さ(秒) */
export const MIN_DURATION = 0.1;

export type RecordOptions = Readonly<{
  /** motion id(^[a-z0-9][a-z0-9._-]*$)。呼び出し側が決める(純粋関数に時計を持たせない) */
  id: string;
  /** 語(字幕に当てはめるラベル) */
  label: string;
  settings?: CaptureSettings;
  /** 残す区間(録画の秒)。省略は全体 */
  trim?: Readonly<{ start: number; end: number }>;
  /** この秒数以下の欠落は補間する。それより長い欠落は補間しない */
  maxGap?: number;
  /** ローパスのカットオフ(Hz)。0 で平滑なし */
  smoothHz?: number;
  outlier?: OutlierOptions;
  decimate?: DecimateOptions;
  /** これ未満のフレーム数しか検出されなかった手は捨てる */
  minHandFrames?: number;
  /** 渡すと、可動域外の関節を警告に入れる(clamp はしない) */
  profile?: AvatarProfile;
}>;

export type RecordResult =
  | Readonly<{ ok: true; motion: MotionDefinition; warnings: readonly CaptureWarning[]; stats: Readonly<{ frames: number; keyframes: number; duration: number }> }>
  | Readonly<{ ok: false; errors: readonly string[] }>;

const SIDES = ['left', 'right'] as const;
const round = (x: number, d: number): number => {
  const r = Math.round(x * 10 ** d) / 10 ** d;
  return r === 0 ? 0 : r; // -0 を出さない
};
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

function roundPose(p: HandPose): HandPose {
  const joints = {} as Record<FingerJoint, readonly [number, number, number]>;
  for (const [j, v] of Object.entries(p.joints)) joints[j as FingerJoint] = [round(v[0], 2), 0, 0];
  const pos = p.wrist.position;
  const rot = p.wrist.rotation;
  return { wrist: { position: [round(pos[0], 4), round(pos[1], 4), round(pos[2], 4)], rotation: [round(rot[0], 2), round(rot[1], 2), round(rot[2], 2)] }, joints };
}

export function buildRecordedMotion(frames: readonly CaptureFrame[], opt: RecordOptions): RecordResult {
  const settings = opt.settings ?? DEFAULT_SETTINGS;
  const errors: string[] = [];
  const label = opt.label.trim();
  if (!label) errors.push('ラベル(語)が空');
  if (!ID_RE.test(opt.id)) errors.push(`id が不正: ${opt.id}`);
  if (!(settings.armLength >= 0.3 && settings.armLength <= 1.2)) errors.push('腕の長さは 0.3〜1.2 m');
  if (!(settings.aspect > 0) || !(settings.fovH > 0 && settings.fovH < 180) || !(settings.chestDistance > 0)) errors.push('カメラ設定が不正');
  if (opt.trim && !(opt.trim.end > opt.trim.start)) errors.push('トリミングの終了は開始より後');
  if (errors.length) return { ok: false, errors };

  const warnings: CaptureWarning[] = [];
  // 時刻順・1ms 以上の間隔のフレームだけ使う
  const sorted: CaptureFrame[] = [];
  for (const f of [...frames].sort((a, b) => a.time - b.time)) {
    if (Number.isFinite(f.time) && (!sorted.length || f.time > sorted[sorted.length - 1].time + 0.001)) sorted.push(f);
  }
  const tracks: Record<Side, Sample[]> = { left: [], right: [] };
  const duplicates: Record<Side, number> = { left: 0, right: 0 };
  for (const f of sorted) {
    const found: Partial<Record<Side, { pose: HandPose; score: number }>> = {};
    for (const h of f.hands) {
      const r = handToPose(h, settings);
      if (!r.ok) continue;
      const prev = found[r.side];
      if (prev) duplicates[r.side]++;
      if (!prev || (h.score ?? 0) > prev.score) found[r.side] = { pose: r.pose, score: h.score ?? 0 };
    }
    for (const s of SIDES) tracks[s].push({ t: f.time, v: found[s] ? poseToChannels(found[s].pose) : null });
  }

  const minFrames = opt.minHandFrames ?? 3;
  const keyed: { side: Side; t: number; pose: HandPose }[] = [];
  for (const side of SIDES) {
    if (duplicates[side]) warnings.push({ kind: 'duplicate-side', side, frames: duplicates[side] });
    const detected = tracks[side].filter((s) => s.v).length;
    if (detected < minFrames) {
      if (detected > 0) warnings.push({ kind: 'dropped-hand', side, frames: detected });
      continue;
    }
    const unwrapped = unwrapRotation(tracks[side]);
    const cleaned = removeOutliers(unwrapped, opt.outlier ?? DEFAULT_OUTLIER);
    if (cleaned.removed) warnings.push({ kind: 'outliers', side, frames: cleaned.removed });
    const filled = fillGaps(cleaned.samples, opt.maxGap ?? 0.3);
    for (const g of filled.longGaps) warnings.push({ kind: 'long-gap', side, seconds: round(g, 2) });
    const smoothed = smooth(filled.samples, opt.smoothHz ?? 6);
    const trimmed = opt.trim ? trimSamples(smoothed, opt.trim.start, opt.trim.end) : smoothed;
    if (trimmed.filter((s) => s.v).length < 2) continue;
    for (const i of decimate(trimmed, opt.decimate ?? DEFAULT_DECIMATE)) {
      keyed.push({ side, t: trimmed[i].t, pose: roundPose(channelsToPose(wrapRotation(trimmed[i].v as number[]))) });
    }
  }
  if (!keyed.length) return { ok: false, errors: ['有効な手の検出がありません(検出なし、または短すぎる)'] };

  const t0 = Math.min(...keyed.map((k) => k.t));
  const byTime = new Map<number, { left?: HandPose; right?: HandPose }>();
  for (const k of keyed) {
    const t = round(k.t - t0, 3);
    byTime.set(t, { ...byTime.get(t), [k.side]: k.pose });
  }
  const keyframes: Keyframe[] = [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([time, pose]) => ({ time, pose: pose as Pose }));
  const duration = keyframes[keyframes.length - 1].time;
  if (duration < MIN_DURATION) return { ok: false, errors: [`録画が短すぎます(${duration} 秒。${MIN_DURATION} 秒以上必要)`] };

  const motion: MotionDefinition = {
    schemaVersion: '0.1.0',
    id: opt.id,
    category: 'sign-like-gesture',
    provenance: { status: 'unreviewed', source: RECORDED_SOURCE },
    semantic: { label },
    duration,
    keyframes,
  };
  const v = validateMotion(motion);
  if (!v.ok) return { ok: false, errors: v.errors };
  if (opt.profile) warnings.push(...rangeWarnings(motion, opt.profile));
  return { ok: true, motion: v.value, warnings, stats: { frames: sorted.length, keyframes: keyframes.length, duration } };
}

/** 可動域(右手基準。左手は右手規約の値なので同じ範囲で比べる)を超える関節を、side/joint/axis ごとに集計する。clamp はしない。 */
export function rangeWarnings(motion: MotionDefinition, profile: AvatarProfile): RangeWarning[] {
  const acc = new Map<string, { w: RangeWarning; min: number; max: number; count: number }>();
  const AXES = ['x', 'y', 'z'] as const;
  for (const k of motion.keyframes) {
    for (const side of SIDES) {
      const hp = k.pose[side];
      if (!hp) continue;
      const entries: [string, readonly number[]][] = [['wrist', hp.wrist.rotation], ...Object.entries(hp.joints)];
      for (const [joint, rot] of entries) {
        const range = (profile.rangeOfMotion as Record<string, AxisRange | undefined>)[joint];
        if (!range) continue;
        AXES.forEach((axis, i) => {
          const lim = range[axis];
          if (!lim) return;
          const val = rot[i];
          if (val >= lim[0] && val <= lim[1]) return;
          const key = `${side}/${joint}/${axis}`;
          const cur = acc.get(key);
          if (cur) {
            cur.count++;
            cur.min = Math.min(cur.min, val);
            cur.max = Math.max(cur.max, val);
          } else {
            acc.set(key, { w: { kind: 'range', side, joint, axis, count: 0, min: 0, max: 0, limit: lim }, min: val, max: val, count: 1 });
          }
        });
      }
    }
  }
  return [...acc.values()].map(({ w, min, max, count }) => ({ ...w, count, min: round(min, 1), max: round(max, 1) }));
}
