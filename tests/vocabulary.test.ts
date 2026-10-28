import { describe, expect, it } from 'vitest';
import { PRESET_MOTIONS } from '../src/text/presets';
import { buildVocabulary, textToSequence } from '../src/text/vocabulary';
import { samplePose } from '../src/motion/interpolate';
import { buildTimeline, sampleTimeline, TRANSITION, UNKNOWN_DURATION } from '../src/motion/timeline';
import { REST_POSE } from '../src/motion/rest';
import { checkRangeOfMotion, isReviewedSignLanguage, validateAvatarProfile } from '../src/validate';
import vrmJson from '../samples/vrm1-humanoid.avatar-profile.json';
import { MODE_NAME, UNREVIEWED_BADGE, provenanceBadge, unknownCaption } from '../src/ui/labels';

const ids = (s: ReturnType<typeof textToSequence>) => s.map((i) => (i.kind === 'motion' ? i.motion.semantic.label : `?${i.token}`));

describe('プリセット', () => {
  it('5語彙、すべて sign-like-gesture・unreviewed・手話扱いされない', () => {
    expect(PRESET_MOTIONS.map((m) => m.semantic.label).sort()).toEqual(['ありがとう', 'こんにちは', '好き', '歌う', '食べる'].sort());
    for (const m of PRESET_MOTIONS) {
      expect(m.category).toBe('sign-like-gesture');
      expect(m.provenance.status).toBe('unreviewed');
      expect(isReviewedSignLanguage(m)).toBe(false);
    }
  });
  it('VRM profile の可動域内に収まる', () => {
    const p = validateAvatarProfile(vrmJson);
    if (!p.ok) throw new Error('bad');
    for (const m of PRESET_MOTIONS) expect(checkRangeOfMotion(m, p.value), m.id).toEqual([]);
  });
});

describe('テキスト → プリセット列', () => {
  it('語彙一致(漢字・かな・活用形)', () => {
    expect(ids(textToSequence('ありがとう'))).toEqual(['ありがとう']);
    expect(ids(textToSequence('すき'))).toEqual(['好き']);
    expect(ids(textToSequence('たべる 歌う'))).toEqual(['食べる', '歌う']);
  });
  it('区切りなしの連続・句読点・全角/半角ゆれ', () => {
    expect(ids(textToSequence('こんにちは、ありがとう！'))).toEqual(['こんにちは', 'ありがとう']);
    expect(ids(textToSequence('ありがとうこんにちは'))).toEqual(['ありがとう', 'こんにちは']);
  });
  it('同じ位置で複数の表記が一致するときは長いほうを優先', () => {
    const [m] = PRESET_MOTIONS;
    const vocab = [
      { motion: { ...m, semantic: { label: '短' } }, keys: ['あり'] },
      { motion: { ...m, semantic: { label: '長' } }, keys: ['ありがとう'] },
    ];
    expect(ids(textToSequence('ありがとう', vocab))).toEqual(['長']);
    expect(buildVocabulary([m])[0].keys).toContain('ありがとう');
  });
  it('未知語は無動作の unknown(motion を持たない)', () => {
    const s = textToSequence('あした ありがとう さようなら');
    expect(ids(s)).toEqual(['?あした', 'ありがとう', '?さようなら']);
    expect(s[0].kind).toBe('unknown');
    expect('motion' in s[0]).toBe(false);
  });
  it('空文字・区切りのみは空列', () => {
    expect(textToSequence('')).toEqual([]);
    expect(textToSequence(' 、。 ')).toEqual([]);
  });
});

describe('誤爆の回帰(短い語幹・長音・ハイフン)', () => {
  it.each(['うたがう', '好奇心', '歌舞伎', 'すきやき', 'ラーメン', 'a-b'])('「%s」は身振りにならず未知語1区間', (w) => {
    const s = textToSequence(w);
    expect(s).toHaveLength(1);
    expect(s[0].kind).toBe('unknown');
  });
  it('短い表記の境界判定: 続く語彙・装飾・終助詞', () => {
    expect(ids(textToSequence('歌ってね'))).toEqual(['歌う', '?ね']);
    expect(ids(textToSequence('すきありがとう'))).toEqual(['好き', 'ありがとう']);
    expect(ids(textToSequence('好き歌う'))).toEqual(['好き', '歌う']);
    expect(ids(textToSequence('すきすき'))).toEqual(['好き', '好き']);
    for (const w of ['好き〜', '好きー', '歌う〜', '好きっ', '好き♪', '好き♡♡']) expect(textToSequence(w), w).toHaveLength(1);
    expect(ids(textToSequence('好き〜'))).toEqual(['好き']);
    for (const w of ['歌うよ', '歌うね', '歌うの', '好きよ', '好きね', '好きで', '好きだ', '食べるよ']) {
      const s = textToSequence(w);
      expect(s, w).toHaveLength(1);
      expect(s[0].kind).toBe('motion');
    }
  });
  it('活用形は身振りになる', () => {
    expect(ids(textToSequence('歌って'))).toEqual(['歌う']);
    expect(ids(textToSequence('好きな'))).toEqual(['好き']);
    expect(ids(textToSequence('ありがとー'))).toEqual(['ありがとう']);
  });
  it('全角・半角ゆれ(NFKC)で一致、区切りで未知語が分かれる', () => {
    const [m] = PRESET_MOTIONS;
    const vocab = [{ motion: m, keys: ['ABC'] }];
    expect(textToSequence('ＡＢＣ', vocab).map((i) => i.kind)).toEqual(['motion']);
    expect(textToSequence('ABC DEF GHI').map((i) => i.token)).toEqual(['ABC', 'DEF', 'GHI']);
  });
});

describe('タイムライン', () => {
  it('2語目の区間内は samplePose(motion, t - start) と一致し、終端以降は終端姿勢(先頭姿勢ではない)', () => {
    const tl = buildTimeline(textToSequence('好き 歌う'));
    const [a, b] = tl.segments;
    const t = b.start + 0.7;
    expect(sampleTimeline(tl, t).pose).toEqual(samplePose(b.motion!, t - b.start));
    const end = samplePose(b.motion!, b.motion!.duration);
    expect(sampleTimeline(tl, tl.total + 5).pose).toEqual(end);
    expect(end).not.toEqual(samplePose(b.motion!, 0));
    expect(a.motion).toBeDefined();
  });
  it('語間の遷移は前区間の終端と次区間の先頭の中間(ease-in-out の中点=平均)', () => {
    const tl = buildTimeline(textToSequence('好き 歌う'));
    const [a, b] = tl.segments;
    const from = samplePose(a.motion!, a.motion!.duration).right.wrist.position;
    const to = samplePose(b.motion!, 0).right.wrist.position;
    expect(from).not.toEqual(to);
    const mid = sampleTimeline(tl, a.end + TRANSITION / 2).pose.right.wrist.position;
    mid.forEach((v, i) => expect(v).toBeCloseTo((from[i] + to[i]) / 2));
  });

  it('区間の並びと遷移間隔、未知語の長さ', () => {
    const tl = buildTimeline(textToSequence('こんにちは あした 好き'));
    const [a, b, c] = tl.segments;
    expect(a.start).toBe(0);
    expect(b.start).toBeCloseTo(a.end + TRANSITION);
    expect(b.end - b.start).toBe(UNKNOWN_DURATION);
    expect(c.start).toBeCloseTo(b.end + TRANSITION);
    expect(tl.total).toBeCloseTo(c.end);
  });
  it('未知語の区間は待機姿勢(無動作)、motion 区間は motion の姿勢', () => {
    const tl = buildTimeline(textToSequence('あした 好き'));
    const mid = sampleTimeline(tl, 0.5);
    expect(mid.pose).toEqual(REST_POSE);
    expect(mid.segmentIndex).toBe(0);
    const t2 = tl.segments[1].start + 0.3;
    const s = sampleTimeline(tl, t2);
    expect(s.segmentIndex).toBe(1);
    expect(s.phase).toBe('motion');
    expect(s.pose).not.toEqual(REST_POSE);
  });
  it('遷移中は直前区間を指し、前後の中間姿勢になる。空なら idle', () => {
    const tl = buildTimeline(textToSequence('好き 歌う'));
    const t = tl.segments[0].end + TRANSITION / 2;
    const s = sampleTimeline(tl, t);
    expect(s.phase).toBe('transition');
    expect(s.segmentIndex).toBe(0);
    expect(sampleTimeline(buildTimeline([]), 1).phase).toBe('idle');
  });
});

describe('UI 文言: モードの線引き', () => {
  it('モード名は指文字/身振り支援、バッジは未監修・手話風身振り', () => {
    expect(MODE_NAME).toBe('指文字/身振り支援');
    expect(UNREVIEWED_BADGE).toBe('未監修・手話風身振り');
    for (const m of PRESET_MOTIONS) expect(provenanceBadge(m)).toBe(UNREVIEWED_BADGE);
  });
  it('src と index.html に「手話通訳」「手話翻訳」を名乗る文言がない', () => {
    const srcs = import.meta.glob(['../src/**/*.ts', '../index.html'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(srcs).length).toBeGreaterThan(8);
    for (const [f, text] of Object.entries(srcs)) expect(text, f).not.toMatch(/手話通訳|手話翻訳/);
    expect(unknownCaption('x')).not.toMatch(/手話通訳|手話翻訳/);
  });
});
