// 出力層の共通中間オブジェクト(brief model)。runtime JSON / retarget 指示書(YAML)/ 指示書(Markdown)は
// すべてこの1つから生成する(片方だけが持つ情報を作らない)。Three.js / DOM 非依存の純粋関数。
import { FINGER_JOINTS } from '../types/definition';
import type { AvatarProfile, MotionDefinition, Side } from '../types/definition';
import { isGestureOnly, retargetMotion } from '../retarget';
import type { Mode } from '../modes';
import type { CueTimeline } from '../motion/cueTimeline';

export const BRIEF_VERSION = '0.1.0';

/** 未監修・手話風身振りの注意文。手話そのものを名乗る語句(通訳・翻訳・対応の名乗り)を含めない */
export const BRIEF_NOTICE =
  '未監修・手話風身振り: この出力のモーションはネイティブ手話話者の監修を受けていない手話風の身振り/指文字風の手の形です。手話そのものとして通訳・翻訳・対応を名乗らず、当事者の確認を経ていない場面では実手話として提示しないこと。';

/** 優先順位(上ほど優先)。docs/spec.md「エージェント向け retarget 指示」で明記 */
export const PRIORITIES = [
  { rank: 1, id: 'palm-orientation', text: '手のひらの向き(手首の回転)を最優先で保つ。' },
  { rank: 2, id: 'wrist-position', text: '次に手首の位置。可動域や骨格差で合わせきれないときは、手のひらの向きを保つ範囲でずらしてよい。' },
  { rank: 3, id: 'finger-detail', text: '指の細部は最後。足りない/丸められるときは読み取れる手の形を残し、細部を捨てる。指ボーンが無ければ gesture-only に落とす。' },
] as const;

export const CONVENTIONS = {
  rotation: 'euler 角(度)[x,y,z]、intrinsic XYZ 順。右手のローカル軸で x=屈曲(正で指を曲げる/手首は掌屈)、y=ひねり(正で回内)、z=橈側偏位(正で母指側へ倒す/手首は橈屈)。',
  position: 'wrist.position は meter。原点は演者の胸中央、+x=演者の右、+y=上、+z=前方。',
  mirror: '左手は右手と同じ規約で書かれた値を、適用時に鏡像変換する(位置 x と回転 y・z の符号を反転)。rangeOfMotion も右手基準で、左手には鏡像として同じ値を使う。',
  order: '適用順: 可動域 clamp(右手基準)→ 左手のみ鏡像変換 → restPoseCorrection(ボーン名一致)を加算。',
  reference: 'docs/spec.md「データモデル」「avatar profile」、schema/motion.schema.json、schema/avatar-profile.schema.json',
} as const;

export type BriefProvenance = Readonly<{ status: 'unreviewed' | 'reviewed'; reviewer?: string; reviewedAt?: string; source?: string }>;
export type BriefVocabulary = Readonly<{ id: string; label: string; category: MotionDefinition['category']; provenance: BriefProvenance; duration: number }>;
export type BriefGesture = Readonly<{ token: string; motionId: string; start: number; end: number }>;
export type BriefCue = Readonly<{
  index: number;
  start: number;
  end: number;
  text: string;
  speed: number;
  gestures: readonly BriefGesture[];
  /** 速度上限のため省略した語(字幕のみ) */
  omitted: readonly string[];
  /** 語彙にない語(字幕のみ) */
  unsupported: readonly string[];
}>;
export type BriefCaptionOnly = Readonly<{ cue: number; token: string; reason: 'unsupported' | 'omitted' }>;
export type BriefBone = Readonly<{ key: string; bone: string | null; required: boolean }>;
export type BriefClamp = Readonly<{ axis: string; count: number; motionIds: readonly string[] }>;

export type BriefModel = Readonly<{
  briefVersion: string;
  notice: string;
  mode: Readonly<{ kind: Mode['kind'] }>;
  motion: Readonly<{
    totalSeconds: number;
    categories: readonly string[];
    provenanceStates: readonly string[];
    vocabulary: readonly BriefVocabulary[];
    cues: readonly BriefCue[];
    captionOnly: readonly BriefCaptionOnly[];
  }>;
  avatar: Readonly<{
    profileId: string;
    rig: AvatarProfile['rig'];
    capability: AvatarProfile['capability'];
    bones: readonly BriefBone[];
    missingRequired: readonly string[];
    missingOptional: readonly string[];
    fallback: Readonly<{ mode: 'none' | 'gesture-only'; reason: 'declared' | 'missing-finger-bones' | null; effect: string }>;
  }>;
  /** 可動域超過で丸められる軸(`side/joint/axis`)。gesture-only では指は出力しないので対象外 */
  clamped: readonly BriefClamp[];
  priorities: typeof PRIORITIES;
  conventions: typeof CONVENTIONS;
}>;

/** brief model と、runtime JSON が同梱する motion 定義(実際に使われたもの)。 */
export type BriefSource = Readonly<{ brief: BriefModel; motions: readonly MotionDefinition[] }>;

const r3 = (x: number): number => Math.round(x * 1000) / 1000;
const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

function provenanceOf(m: MotionDefinition): BriefProvenance {
  const p = m.provenance;
  return { status: p.status, ...(p.reviewer ? { reviewer: p.reviewer } : {}), ...(p.reviewedAt ? { reviewedAt: p.reviewedAt } : {}), ...(p.source ? { source: p.source } : {}) };
}

function describeBones(profile: AvatarProfile): BriefBone[] {
  const out: BriefBone[] = [];
  for (const side of ['left', 'right'] as const satisfies readonly Side[]) {
    const b = profile.bones[side];
    out.push({ key: `${side}.wrist`, bone: b.wrist, required: true });
    for (const j of FINGER_JOINTS) out.push({ key: `${side}.${j}`, bone: b.fingers?.[j] ?? null, required: true });
    out.push({ key: `${side}.shoulder`, bone: b.shoulder ?? null, required: false });
    out.push({ key: `${side}.elbow`, bone: b.elbow ?? null, required: false });
  }
  for (const [k, v] of Object.entries(profile.bones.face ?? {})) out.push({ key: `face.${k}`, bone: v, required: false });
  if (!profile.bones.face) out.push({ key: 'face', bone: null, required: false });
  return out;
}

const FALLBACK_EFFECT = {
  none: 'フォールバックなし。指の回転も出力する。',
  'gesture-only': '指の回転は出力しない。手首/腕のボーンだけを動かす(gesture-only)。指の細部は捨て、手のひらの向きと手首の位置で身振りを伝える。',
} as const;

export function buildBrief(timeline: CueTimeline, mode: Mode, profile: AvatarProfile): BriefSource {
  const used = new Map<string, MotionDefinition>();
  const cues: BriefCue[] = timeline.segments.map((s) => {
    const gestures: BriefGesture[] = (s.gestures?.segments ?? []).flatMap((g) => {
      if (!g.motion) return [];
      used.set(g.motion.id, g.motion);
      return [{ token: g.token, motionId: g.motion.id, start: r3(s.cue.start + g.start / s.speed), end: r3(s.cue.start + g.end / s.speed) }];
    });
    return { index: s.index, start: r3(s.cue.start), end: r3(s.end), text: s.cue.text, speed: r3(s.speed), gestures, omitted: [...s.omitted], unsupported: [...s.unsupported] };
  });
  const motions = [...used.values()];
  const captionOnly = cues.flatMap((c): BriefCaptionOnly[] => [
    ...c.unsupported.map((token) => ({ cue: c.index, token, reason: 'unsupported' as const })),
    ...c.omitted.map((token) => ({ cue: c.index, token, reason: 'omitted' as const })),
  ]);

  const bones = describeBones(profile);
  const gestureOnly = isGestureOnly(profile);
  const fallbackMode = gestureOnly ? 'gesture-only' : 'none';

  // 実際に retargetMotion を走らせ、可動域で丸められた軸を集計する
  const counts = new Map<string, { count: number; ids: Set<string> }>();
  for (const m of motions) {
    for (const axis of retargetMotion(m, profile).clamped) {
      const e = counts.get(axis) ?? { count: 0, ids: new Set<string>() };
      e.count += 1;
      e.ids.add(m.id);
      counts.set(axis, e);
    }
  }
  const clamped = [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([axis, e]): BriefClamp => ({ axis, count: e.count, motionIds: [...e.ids] }));

  return {
    brief: {
      briefVersion: BRIEF_VERSION,
      notice: BRIEF_NOTICE,
      mode: { kind: mode.kind },
      motion: {
        totalSeconds: r3(timeline.total),
        categories: unique(motions.map((m) => m.category)),
        provenanceStates: unique(motions.map((m) => m.provenance.status)),
        vocabulary: motions.map((m) => ({ id: m.id, label: m.semantic.label, category: m.category, provenance: provenanceOf(m), duration: r3(m.duration) })),
        cues,
        captionOnly,
      },
      avatar: {
        profileId: profile.id,
        rig: profile.rig,
        capability: profile.capability,
        bones,
        missingRequired: bones.filter((b) => b.required && !b.bone).map((b) => b.key),
        missingOptional: bones.filter((b) => !b.required && !b.bone).map((b) => b.key),
        fallback: { mode: fallbackMode, reason: !gestureOnly ? null : profile.capability === 'gesture-only' ? 'declared' : 'missing-finger-bones', effect: FALLBACK_EFFECT[fallbackMode] },
      },
      clamped,
      priorities: PRIORITIES,
      conventions: CONVENTIONS,
    },
    motions,
  };
}
