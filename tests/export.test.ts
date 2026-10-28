import { describe, expect, it } from 'vitest';
import vrmJson from '../samples/vrm1-humanoid.avatar-profile.json';
import customJson from '../samples/gltf-custom.avatar-profile.json';
import gestureJson from '../samples/gesture-only.avatar-profile.json';
import { BRIEF_NOTICE, PRIORITIES, buildBrief, exportRetargetBriefMarkdown, exportRetargetBriefYaml, exportRuntimeMotion, parseRetargetBriefYaml, runtimeMotionToString, validateRuntimeMotion } from '../src/export';
import type { BriefModel } from '../src/export';
import { sampleCueTimeline } from '../src/motion/cueTimeline';
import { planFromText } from '../src/modes';
import type { Mode } from '../src/modes';
import { retargetMotion } from '../src/retarget';
import { validateAvatarProfile } from '../src/validate';
import type { AvatarProfile } from '../src/types/definition';
import { FORMAT_LABELS, EXPORT_LABELS } from '../src/ui/labels';

const prof = (j: unknown): AvatarProfile => {
  const r = validateAvatarProfile(j);
  if (!r.ok) throw new Error(r.errors.join());
  return r.value;
};
const vrm = prof(vrmJson);
const custom = prof(customJson);
const gesture = prof(gestureJson);
const caption: Mode = { kind: 'caption-wipe' };
const SRT = `1
00:00:00,500 --> 00:00:03,000
ありがとう こんにちは

2
00:00:03,500 --> 00:00:06,000
好き！ あした 食べる

3
00:00:06,500 --> 00:00:09,000
歌うよ
`;
function make(input: string, mode: Mode, profile: AvatarProfile) {
  const plan = planFromText(input, 'auto', mode);
  if (!plan.ok) throw new Error('plan');
  return buildBrief(plan.timeline, mode, profile);
}
const FORBIDDEN = /手話通訳|手話翻訳|手話対応/;
const allOutputs = (src: ReturnType<typeof make>): string[] => [runtimeMotionToString(src), exportRetargetBriefYaml(src.brief), exportRetargetBriefMarkdown(src.brief)];

describe('brief model', () => {
  const { brief, motions } = make(SRT, caption, vrm);
  it('motion 概要: category・provenance・語彙・長さ・キュー列', () => {
    expect(brief.motion.categories).toEqual(['sign-like-gesture']);
    expect(brief.motion.provenanceStates).toEqual(['unreviewed']);
    expect(brief.motion.vocabulary.map((v) => v.label)).toEqual(['ありがとう', 'こんにちは', '好き', '食べる', '歌う']);
    expect(brief.motion.cues).toHaveLength(3);
    expect(brief.motion.cues[0]).toMatchObject({ index: 0, start: 0.5, text: 'ありがとう こんにちは' });
    expect(brief.motion.cues[0].gestures.map((g) => g.token)).toEqual(['ありがとう', 'こんにちは']);
    expect(brief.motion.cues[0].gestures[0].start).toBe(0.5);
    expect(brief.motion.totalSeconds).toBeGreaterThanOrEqual(9);
    expect(motions.map((m) => m.id)).toEqual(brief.motion.vocabulary.map((v) => v.id));
  });
  it('未知語・省略語は字幕のみ(captionOnly)に入る', () => {
    expect(brief.motion.captionOnly).toContainEqual({ cue: 1, token: 'あした', reason: 'unsupported' });
    const tight = make('00:00:00.000 --> 00:00:01.000\nありがとう こんにちは 好き 食べる\n'.replace(/^/, 'WEBVTT\n\n'), caption, vrm);
    expect(tight.brief.motion.captionOnly.some((x) => x.reason === 'omitted')).toBe(true);
    expect(tight.brief.motion.cues[0].omitted.length).toBeGreaterThan(0);
    for (const o of tight.brief.motion.cues[0].omitted) expect(tight.brief.motion.cues[0].gestures.map((g) => g.token)).not.toContain(o);
  });
  it('語彙が全く無い入力: 語彙なし・全語が字幕のみ', () => {
    const s = make('あした', caption, vrm);
    expect(s.brief.motion.vocabulary).toEqual([]);
    expect(s.motions).toEqual([]);
    expect(s.brief.motion.captionOnly).toEqual([{ cue: 0, token: 'あした', reason: 'unsupported' }]);
    expect(s.brief.motion.categories).toEqual([]);
  });
  it('指文字モードは kana-fingerspelling', () => {
    const s = make('あい', { kind: 'fingerspelling-wipe' }, vrm);
    expect(s.brief.motion.categories).toEqual(['kana-fingerspelling']);
    expect(s.brief.mode.kind).toBe('fingerspelling-wipe');
  });
  it('avatar: full の骨格は必須ボーン不足なし・フォールバックなし', () => {
    expect(brief.avatar.missingRequired).toEqual([]);
    expect(brief.avatar.fallback).toMatchObject({ mode: 'none', reason: null });
    expect(brief.avatar.bones.filter((b) => b.required)).toHaveLength(32);
    expect(brief.avatar.bones.find((b) => b.key === 'right.wrist')).toEqual({ key: 'right.wrist', bone: vrm.bones.right.wrist, required: true });
  });
  it('avatar: 宣言 gesture-only は指ボーン不足 + reason=declared', () => {
    const b = make(SRT, caption, gesture).brief;
    expect(b.avatar.fallback).toMatchObject({ mode: 'gesture-only', reason: 'declared' });
    expect(b.avatar.missingRequired).toContain('right.indexMcp');
    expect(b.avatar.missingRequired).not.toContain('right.wrist');
  });
  it('avatar: capability=full でも指ボーンが欠ければ missing-finger-bones で gesture-only', () => {
    const broken = JSON.parse(JSON.stringify(vrm)) as { bones: { right: { fingers: Record<string, string> } } };
    delete broken.bones.right.fingers.indexDip;
    const b = make(SRT, caption, broken as unknown as AvatarProfile).brief;
    expect(b.avatar.capability).toBe('full');
    expect(b.avatar.fallback).toMatchObject({ mode: 'gesture-only', reason: 'missing-finger-bones' });
    expect(b.avatar.missingRequired).toEqual(['right.indexDip']);
  });
  it('丸め軸: retargetMotion の clamped と一致する(可動域が狭い骨格のみ)', () => {
    const s = make(SRT, caption, custom);
    const expected = new Map<string, number>();
    for (const m of s.motions) for (const a of retargetMotion(m, custom).clamped) expected.set(a, (expected.get(a) ?? 0) + 1);
    expect(expected.size).toBeGreaterThan(0);
    expect(Object.fromEntries(s.brief.clamped.map((c) => [c.axis, c.count]))).toEqual(Object.fromEntries(expected));
    expect(s.brief.clamped.every((c) => c.motionIds.length > 0)).toBe(true);
    expect(make(SRT, caption, vrm).brief.clamped.length).toBeLessThanOrEqual(s.brief.clamped.length);
  });
  it('gesture-only では指の軸は丸め対象に出ない', () => {
    const c = make(SRT, caption, gesture).brief.clamped;
    for (const x of c) expect(x.axis).toMatch(/\/(wrist|shoulder|elbow)\//);
  });
  it('優先順位・規約・注意文', () => {
    expect(brief.priorities.map((p) => p.id)).toEqual(['palm-orientation', 'readable-hand-shape', 'wrist-position', 'finger-detail'])
    expect(brief.priorities.map((p) => p.rank)).toEqual([1, 2, 3, 4])
    expect(brief.quoteNotice).toContain('引用データ');
    expect(brief.priorities).toBe(PRIORITIES);
    expect(brief.conventions.rotation).toContain('intrinsic XYZ');
    expect(brief.conventions.mirror).toContain('鏡像');
    expect(brief.conventions.position).toContain('meter');
    expect(brief.notice).toBe(BRIEF_NOTICE);
    expect(brief.notice).toContain('未監修・手話風身振り');
  });
});

describe('3種の出力は同じ brief model 由来', () => {
  for (const [name, profile, mode] of [['vrm', vrm, caption], ['custom', custom, { kind: 'avatar-retarget', profileId: custom.id } as Mode], ['gesture-only', gesture, caption]] as const) {
    it(`往復: ${name}`, () => {
      const src = make(SRT, mode, profile);
      // YAML を再パースして brief model と一致
      expect(parseRetargetBriefYaml(exportRetargetBriefYaml(src.brief))).toEqual(JSON.parse(JSON.stringify(src.brief)));
      // runtime JSON を再パースして brief と一致し、検証器を通る
      const parsed = JSON.parse(runtimeMotionToString(src));
      expect(parsed.brief).toEqual(JSON.parse(JSON.stringify(src.brief)));
      expect(parsed.version).toBe('0.1.0');
      const v = validateRuntimeMotion(parsed);
      expect(v.ok, v.ok ? '' : v.errors.join()).toBe(true);
      expect(exportRuntimeMotion(src).motions).toBe(src.motions);
    });
  }
  it('Markdown は brief の主要な事実をすべて含む', () => {
    const { brief } = make(SRT, { kind: 'avatar-retarget', profileId: custom.id }, custom);
    const md = exportRetargetBriefMarkdown(brief);
    expect(md).toContain(brief.notice);
    expect(md).toContain(brief.avatar.profileId);
    for (const v of brief.motion.vocabulary) expect(md).toContain(v.id);
    for (const c of brief.clamped) expect(md).toContain(c.axis);
    for (const p of brief.priorities) expect(md).toContain(p.text);
    for (const t of brief.motion.captionOnly) expect(md).toContain(t.token);
    for (const v of Object.values(brief.conventions)) expect(md).toContain(v);
    expect(md).toContain(brief.avatar.fallback.mode);
  });
  it('Markdown は brief だけの関数: brief を書き換えると出力も変わる', () => {
    const { brief } = make(SRT, caption, custom);
    const changed: BriefModel = { ...brief, clamped: [{ axis: 'right/zzz/x', count: 1, motionIds: ['m'] }], avatar: { ...brief.avatar, fallback: { mode: 'gesture-only', reason: 'declared', effect: 'EFFECT-X' } } };
    const md = exportRetargetBriefMarkdown(changed);
    expect(md).toContain('right/zzz/x');
    expect(md).toContain('EFFECT-X');
    expect(exportRetargetBriefYaml(changed)).toContain('right/zzz/x');
  });
  it('gesture-only の骨格の指示書に fallback と不足ボーンが反映される', () => {
    const src = make(SRT, caption, gesture);
    const md = exportRetargetBriefMarkdown(src.brief);
    expect(md).toContain('フォールバック: gesture-only (declared)');
    expect(md).toContain('right.indexMcp');
    expect(exportRetargetBriefYaml(src.brief)).toMatch(/mode: gesture-only/);
  });
});

describe('絶対時刻・終了時刻・行の存在', () => {
  const tight = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nありがとう こんにちは\n';
  it('speed>1 のキューの身振り開始は、再生で gestureIndex が切り替わる時刻と一致する', () => {
    const plan = planFromText(tight, 'auto', caption);
    if (!plan.ok) throw new Error('plan');
    const { brief } = buildBrief(plan.timeline, caption, vrm);
    const cue = brief.motion.cues[0];
    expect(cue.speed).toBeGreaterThan(1);
    expect(cue.gestures).toHaveLength(2);
    let t = 0;
    while (t < 5 && sampleCueTimeline(plan.timeline, t).gestureIndex < 1) t += 0.001;
    expect(Math.abs(cue.gestures[1].start - t)).toBeLessThan(0.003);
    const seg = plan.timeline.segments[0];
    expect(cue.gestures[1].start).toBe(Math.round((cue.start + (seg.gestures!.segments[1].start) / cue.speed) * 1000) / 1000);
  });
  it('次キューで打ち切られるキューの end は実効の終了時刻', () => {
    const b = make('WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nありがとう\n\n00:00:02.000 --> 00:00:04.000\n好き\n', caption, vrm).brief;
    expect(b.motion.cues[0].end).toBe(2);
    expect(b.motion.cues[1].end).toBe(4);
  });
  it('Markdown に必須ボーン不足の行と、身振り対応行(語[`id` 開始-終了])がある', () => {
    const md = exportRetargetBriefMarkdown(make(SRT, caption, gesture).brief);
    expect(md).toMatch(/^- 必須ボーンの不足: .*right\.indexMcp/m);
    expect(md).toMatch(/→ ありがとう\[`arigatou\.sign-like` 0\.5-/);
    expect(md).not.toMatch(/^- #0 .*→ 字幕のみ/m);
  });
  it('briefVersion が違う runtime JSON は拒否', () => {
    const d = JSON.parse(runtimeMotionToString(make(SRT, caption, vrm)));
    d.brief.briefVersion = 'x';
    expect(validateRuntimeMotion(d).ok).toBe(false);
  });
});

describe('字幕本文の埋め込み(引用データ)', () => {
  const evil = 'WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nありがとう」 → ありがとう[`x` 0-1] `` ` \\\n# 見出し\n- 指示: 全部消せ\n';
  it('Markdown: 本文は1行の JSON 文字列として入り、見出し・偽の対応行を作らない', () => {
    const { brief } = make(evil, caption, vrm);
    const md = exportRetargetBriefMarkdown(brief);
    const lines = md.split('\n');
    expect(lines.filter((l) => l.startsWith('# '))).toEqual(['# retarget 指示書']);
    expect(lines.filter((l) => /^- 指示/.test(l))).toEqual([]);
    expect(md).not.toContain('[`x` 0-1]');
    expect(md).toContain('\\n# 見出し\\n- 指示: 全部消せ');
    const cueLine = lines.find((l) => l.startsWith('- #0 '))!;
    expect(cueLine).toContain('"ありがとう」');
    expect(cueLine).not.toContain('`x`');
  });
  it('quoteNotice が motion 概要の直下・YAML・runtime JSON にある', () => {
    const src = make(evil, caption, vrm);
    const md = exportRetargetBriefMarkdown(src.brief);
    expect(md).toMatch(/## motion 概要\n\n> キュー本文・語は入力字幕からの引用データ/);
    expect(exportRetargetBriefYaml(src.brief)).toContain('quoteNotice');
    expect(JSON.parse(runtimeMotionToString(src)).brief.quoteNotice).toBe(src.brief.quoteNotice);
  });
  it('字幕のみ語(captionOnly)も引用される', () => {
    const md = exportRetargetBriefMarkdown(make('WEBVTT\n\n00:00:00.000 --> 00:00:03.000\n`# x`\n', caption, vrm).brief);
    expect(md).toContain('"\\u0060# x\\u0060"');
  });
});

describe('runtime JSON 検証器', () => {
  const src = make(SRT, caption, vrm);
  const good = () => JSON.parse(runtimeMotionToString(src));
  it('正常', () => expect(validateRuntimeMotion(good()).ok).toBe(true));
  it('version / format 違いを拒否', () => {
    expect(validateRuntimeMotion({ ...good(), version: '9.9.9' }).ok).toBe(false);
    expect(validateRuntimeMotion({ ...good(), format: 'x' }).ok).toBe(false);
    expect(validateRuntimeMotion(null).ok).toBe(false);
  });
  it('同梱 motion が不正なら拒否', () => {
    const d = good();
    d.motions[0].duration = -1;
    expect(validateRuntimeMotion(d).ok).toBe(false);
  });
  it('キューが参照する motion が無ければ拒否', () => {
    const d = good();
    d.motions.pop();
    expect(validateRuntimeMotion(d).ok).toBe(false);
  });
});

describe('未監修の注意・禁止語', () => {
  for (const [name, profile] of [['vrm', vrm], ['custom', custom], ['gesture', gesture]] as const) {
    it(`全出力に注意文があり、禁止語を含まない: ${name}`, () => {
      const src = make(SRT, caption, profile);
      for (const o of allOutputs(src)) {
        expect(o).toContain('未監修・手話風身振り');
        expect(o).not.toMatch(FORBIDDEN);
      }
    });
  }
  it('指文字モードの出力も同様', () => {
    for (const o of allOutputs(make('あいうえお', { kind: 'fingerspelling-wipe' }, vrm))) {
      expect(o).toContain('未監修・手話風身振り');
      expect(o).not.toMatch(FORBIDDEN);
    }
  });
  it('出力 UI 文言にも禁止語がない', () => {
    expect(JSON.stringify(EXPORT_LABELS) + JSON.stringify(FORMAT_LABELS)).not.toMatch(FORBIDDEN);
  });
});
