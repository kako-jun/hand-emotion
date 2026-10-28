import { describe, expect, it } from 'vitest';
import { FINGERSPELLING_MOTIONS, PRESET_MOTIONS } from '../src/text/presets';
import { textToSequence } from '../src/text/vocabulary';
import { LEAD_IN, MAX_SPEED, RETURN_TO_REST, buildCueTimeline, sampleCueTimeline } from '../src/motion/cueTimeline';
import { buildTimeline, sampleTimeline } from '../src/motion/timeline';
import { samplePose } from '../src/motion/interpolate';
import { REST_POSE } from '../src/motion/rest';
import type { FullPose } from '../src/motion/interpolate';
import { FINGERSPELLING_TRANSITION, planFromText, sequenceForMode, textToFingerspelling } from '../src/modes';
import type { Mode } from '../src/modes';
import { checkRangeOfMotion, isReviewedSignLanguage, validateAvatarProfile, validateMotion } from '../src/validate';
import { MODE_LABELS, FORMAT_LABELS, provenanceBadge } from '../src/ui/labels';
import vrmJson from '../samples/vrm1-humanoid.avatar-profile.json';

const DEFAULT_SRT = `1
00:00:00,500 --> 00:00:03,000
ありがとう こんにちは

2
00:00:03,500 --> 00:00:06,000
好き！ あした 食べる

3
00:00:06,500 --> 00:00:09,000
歌うよ
`;
const items = textToSequence;
const ct = (cues: { start: number; end: number; text: string }[], f = items) => buildCueTimeline(cues, f);
const natural = (text: string) => buildTimeline(items(text).filter((i) => i.kind === 'motion')).total;

describe('キューと身振りの接続(速度上限・省略・待機)', () => {
  it('ちょうど収まる/短い: 速度 1、末尾で待機姿勢へ戻る', () => {
    const d = natural('好き');
    const t = ct([{ start: 2, end: 2 + d + 3, text: '好き' }]);
    expect(t.segments[0].speed).toBe(1);
    expect(t.segments[0].omitted).toEqual([]);
    const s = sampleCueTimeline(t, 2 + d + 3 - 0.01);
    expect(s.phase).toBe('rest');
    expect(s.pose).toEqual(REST_POSE);
  });
  it('字幕時刻に同期: キュー内の時刻 t で、身振り列の (t-start)*speed の姿勢になる', () => {
    const t = ct([{ start: 10, end: 20, text: '好き 歌う' }]);
    const seg = t.segments[0];
    const g = seg.gestures!;
    expect(sampleCueTimeline(t, 10).pose).toEqual(sampleTimeline(g, 0).pose);
    expect(sampleCueTimeline(t, 10.5).pose).toEqual(sampleTimeline(g, 0.5 * seg.speed).pose);
    expect(sampleCueTimeline(t, 10.5).cueIndex).toBe(0);
    expect(sampleCueTimeline(t, 10.5).phase).toBe('gesture');
  });
  it('長い: 速度を上げるが上限 MAX_SPEED を超えない。上限で収まる区間は全部再生', () => {
    const d = natural('好き 歌う');
    const dur = d / 1.2; // 1.2倍で収まる
    const t = ct([{ start: 0, end: dur, text: '好き 歌う' }]);
    expect(t.segments[0].speed).toBeCloseTo(1.2);
    expect(t.segments[0].omitted).toEqual([]);
    const gEnd = sampleCueTimeline(t, dur - 1e-6);
    expect(gEnd.phase).toBe('gesture');
  });
  it('それでも長い: 末尾の語を省略(字幕のみ)し、速度は上限以下・残りは区間内に収まる', () => {
    const one = natural('好き');
    const text = '好き 歌う 食べる ありがとう';
    const t = ct([{ start: 0, end: one, text }]);
    const s = t.segments[0];
    expect(s.speed).toBeLessThanOrEqual(MAX_SPEED + 1e-9);
    expect(s.omitted.length).toBeGreaterThan(0);
    expect(s.gestures!.segments.map((x) => x.token)).toEqual(['好き', '歌う', '食べる', 'ありがとう'].slice(0, s.gestures!.segments.length));
    expect(s.gestures!.total / s.speed).toBeLessThanOrEqual(one + 1e-6);
    expect(s.omitted).toEqual(['好き', '歌う', '食べる', 'ありがとう'].slice(s.gestures!.segments.length));
  });
  it('1語すら上限で収まらない: 身振りなし・字幕のみ(待機姿勢)', () => {
    const t = ct([{ start: 0, end: 0.5, text: '好き' }]);
    expect(t.segments[0].gestures).toBeNull();
    expect(t.segments[0].omitted).toEqual(['好き']);
    expect(sampleCueTimeline(t, 0.2)).toMatchObject({ cueIndex: 0, phase: 'rest', pose: REST_POSE });
  });
  it('未対応語のみ/空: 身振りなし。unsupported に記録', () => {
    const t = ct([{ start: 0, end: 5, text: 'あした' }]);
    expect(t.segments[0].gestures).toBeNull();
    expect(t.segments[0].unsupported).toEqual(['あした']);
    expect(t.segments[0].omitted).toEqual([]);
    expect(ct([{ start: 0, end: 5, text: '' }]).segments[0].gestures).toBeNull();
  });
  it('未知語は身振り列の時間を食わない', () => {
    const a = ct([{ start: 0, end: 5, text: '好き あした 歌う' }]).segments[0];
    const b = ct([{ start: 0, end: 5, text: '好き 歌う' }]).segments[0];
    expect(a.gestures!.total).toBeCloseTo(b.gestures!.total);
  });
  it('キュー間は待機姿勢、次キュー直前は LEAD_IN で先頭姿勢へ寄せ、キュー本体の同期は動かさない', () => {
    const t = ct([{ start: 5, end: 8, text: '好き' }]);
    expect(sampleCueTimeline(t, 1)).toMatchObject({ phase: 'idle', cueIndex: -1, pose: REST_POSE });
    const li = sampleCueTimeline(t, 5 - LEAD_IN / 2);
    expect(li.phase).toBe('lead-in');
    expect(li.cueIndex).toBe(-1);
    const first = samplePose(PRESET_MOTIONS.find((m) => m.semantic.label === '好き')!, 0).right.wrist.position;
    const mid = li.pose.right.wrist.position;
    mid.forEach((v, i) => expect(v).toBeCloseTo((REST_POSE.right.wrist.position[i] + first[i]) / 2));
    expect(sampleCueTimeline(t, 5).phase).toBe('gesture');
  });
  it('重なるキューは次の開始で打ち切る(後勝ち)。終了後は idle', () => {
    const t = ct([
      { start: 0, end: 10, text: '好き' },
      { start: 4, end: 8, text: '歌う' },
    ]);
    expect(t.segments[0].end).toBe(4);
    expect(sampleCueTimeline(t, 3.9).cueIndex).toBe(0);
    expect(sampleCueTimeline(t, 4.1).cueIndex).toBe(1);
    expect(t.total).toBe(8);
    expect(sampleCueTimeline(t, 11).phase).toBe('idle');
  });
  it('待機への復帰は RETURN_TO_REST の間に補間される', () => {
    const t = ct([{ start: 0, end: 20, text: '好き' }]);
    const g = t.segments[0].gestures!;
    const mid = sampleCueTimeline(t, g.total + RETURN_TO_REST / 2);
    expect(mid.phase).toBe('rest');
    const endPose = sampleTimeline(g, g.total).pose.right.wrist.position;
    mid.pose.right.wrist.position.forEach((v, i) => expect(v).toBeCloseTo((endPose[i] + REST_POSE.right.wrist.position[i]) / 2));
  });
  it('空のタイムライン', () => {
    expect(sampleCueTimeline(ct([]), 3)).toMatchObject({ phase: 'idle', cueIndex: -1 });
  });
});

describe('速度上限は 1.5 倍(spec の値をリテラルで固定)', () => {
  it('定数は 1.5。1.4 倍で収まるキューは全部再生、1.6 倍が要るキューは末尾を省略する', () => {
    expect(MAX_SPEED).toBe(1.5);
    const d = natural('好き 歌う');
    const ok = ct([{ start: 0, end: d / 1.4, text: '好き 歌う' }]).segments[0];
    expect(ok.speed).toBeCloseTo(1.4);
    expect(ok.omitted).toEqual([]);
    const over = ct([{ start: 0, end: d / 1.6, text: '好き 歌う' }]).segments[0];
    expect(over.speed).toBeLessThanOrEqual(1.5);
    expect(over.omitted).toEqual(['歌う']);
  });
});

/** 姿勢間の最大差: 手首位置(m)と、手首回転・関節角(度)。連続性の検査用 */
function poseDistance(a: FullPose, b: FullPose): { pos: number; ang: number } {
  let pos = 0;
  let ang = 0;
  for (const side of ['left', 'right'] as const) {
    a[side].wrist.position.forEach((v, i) => (pos = Math.max(pos, Math.abs(v - b[side].wrist.position[i]))));
    a[side].wrist.rotation.forEach((v, i) => (ang = Math.max(ang, Math.abs(v - b[side].wrist.rotation[i]))));
    for (const j of Object.keys(a[side].joints) as (keyof FullPose['left']['joints'])[]) a[side].joints[j].forEach((v, i) => (ang = Math.max(ang, Math.abs(v - b[side].joints[j][i]))));
  }
  return { pos, ang };
}
/** 全体を細かく刻み、隣り合う標本の姿勢差の最大(瞬間移動の検出) */
function maxStep(t: ReturnType<typeof buildCueTimeline>, step = 0.0005): { pos: number; ang: number } {
  let worst = { pos: 0, ang: 0 };
  let prev = sampleCueTimeline(t, 0).pose;
  for (let x = step; x <= t.total + 1; x += step) {
    const cur = sampleCueTimeline(t, x).pose;
    const d = poseDistance(prev, cur);
    worst = { pos: Math.max(worst.pos, d.pos), ang: Math.max(worst.ang, d.ang) };
    prev = cur;
  }
  return worst;
}
// 0.5ms 刻みで見た、自然な動き(短い隙間での寄せを含む)の 1 刻みあたり最大変化の余裕。瞬間移動はこれを大きく超える
const STEP_POS = 0.008;
const STEP_ANG = 1;

describe('姿勢の連続性(境界で手が瞬間移動しない)', () => {
  it('速度 1.5 のキューの末尾→隙間なしの次キュー', () => {
    const d = natural('好き 歌う 食べる');
    const t = ct([
      { start: 0, end: d / 1.5, text: '好き 歌う 食べる' },
      { start: d / 1.5, end: d / 1.5 + 3, text: 'ありがとう' },
    ]);
    expect(t.segments[0].speed).toBeCloseTo(1.5);
    const m = maxStep(t);
    expect(m.pos).toBeLessThan(STEP_POS);
    expect(m.ang).toBeLessThan(STEP_ANG);
  });
  it('隙間なし(0-2s / 2-4s)、短い隙間(0.1s)、字幕のみのキューを挟む場合', () => {
    for (const cues of [
      [{ start: 0, end: 2, text: '好き' }, { start: 2, end: 4, text: '歌う' }],
      [{ start: 0, end: 2, text: '好き' }, { start: 2.1, end: 4, text: '歌う' }],
      [{ start: 0, end: 2, text: '好き' }, { start: 2, end: 4, text: 'あした' }, { start: 4, end: 6, text: '歌う' }],
      [{ start: 0, end: 2, text: '好き' }, { start: 1, end: 4, text: '歌う' }],
    ]) {
      const m = maxStep(ct(cues));
      expect(m.pos, JSON.stringify(cues)).toBeLessThan(STEP_POS);
      expect(m.ang, JSON.stringify(cues)).toBeLessThan(STEP_ANG);
    }
  });
  it('字幕のみキューの前後・挟む場合(隙間 0.1s / 0.4s 未満 / 隙間なし)', () => {
    const g = { start: 0, end: 2, text: '好き' };
    for (const cues of [
      [g, { start: 2.1, end: 4, text: 'あした' }, { start: 4.1, end: 6, text: '歌う' }],
      [g, { start: 2, end: 2.3, text: 'あした' }, { start: 2.3, end: 4, text: '歌う' }],
      [g, { start: 2, end: 2.3, text: 'あした' }, { start: 2.5, end: 4, text: '歌う' }],
      [g, { start: 2, end: 3, text: 'あした' }, { start: 3.0, end: 5, text: 'ありがとう' }],
      // 字幕のみキューの途中から次が始まる(前のキューが自分のブレンドの最中)
      [g, { start: 2, end: 2.1, text: 'あした' }, { start: 2.1, end: 4, text: '歌う' }],
      [{ start: 0, end: 1, text: '好き' }, { start: 1, end: 1.1, text: 'あした' }, { start: 1.1, end: 3, text: '歌う' }],
      [{ start: 0, end: 0.1, text: 'あした' }, { start: 0.1, end: 0.2, text: 'あした' }, { start: 0.2, end: 2, text: '歌う' }],
    ]) {
      const m = maxStep(ct(cues));
      expect(m.pos, JSON.stringify(cues)).toBeLessThan(STEP_POS);
      expect(m.ang, JSON.stringify(cues)).toBeLessThan(STEP_ANG);
    }
  });
  it('短いジェスチャーキューの連鎖(0.05/0.1/0.2/0.3 秒刻み)', () => {
    for (const w of [0.05, 0.1, 0.2, 0.3]) {
      const cues = ['好き', '歌う', '食べる', 'ありがとう', 'こんにちは'].map((text, i) => ({ start: i * w, end: (i + 1) * w + 0.5, text }));
      const m = maxStep(ct(cues));
      expect(m.pos, `w=${w}`).toBeLessThan(STEP_POS);
      expect(m.ang, `w=${w}`).toBeLessThan(STEP_ANG);
    }
  });
  it('極端に短い隙間(0.5ms / 1ms / 10ms / 50ms)', () => {
    for (const gap of [0.0005, 0.001, 0.01, 0.05]) {
      const m = maxStep(ct([{ start: 0, end: 2, text: '好き' }, { start: 2 + gap, end: 4, text: '歌う' }]));
      expect(m.pos, `gap=${gap}`).toBeLessThan(STEP_POS);
      expect(m.ang, `gap=${gap}`).toBeLessThan(STEP_ANG);
    }
  });
  it('開始時刻が同じキュー(長さ 0 の区間)', () => {
    for (const cues of [
      [{ start: 0, end: 2, text: '好き' }, { start: 1, end: 3, text: '歌う' }, { start: 1, end: 4, text: 'ありがとう' }],
      [{ start: 0, end: 3, text: '好き' }, { start: 3, end: 5, text: 'あした' }, { start: 3, end: 6, text: '歌う' }],
      // 隙間のあと、開始時刻が同じ2キュー(手前側は長さ 0)。先頭への寄せが手前側に奪われない
      [{ start: 0, end: 2, text: '好き' }, { start: 4, end: 6, text: '歌う' }, { start: 4, end: 7, text: 'ありがとう' }],
    ]) {
      const m = maxStep(ct(cues));
      expect(m.pos, JSON.stringify(cues)).toBeLessThan(STEP_POS);
      expect(m.ang, JSON.stringify(cues)).toBeLessThan(STEP_ANG);
    }
  });
  it('total は最後の身振りの待機への復帰が終わるまで含み、復帰が実際に再生される', () => {
    const d = natural('好き 歌う 食べる');
    const t = ct([{ start: 0, end: d / 1.5, text: '好き 歌う 食べる' }]);
    const g = t.segments[0];
    expect(t.total).toBeCloseTo(g.gestures!.total / g.speed + RETURN_TO_REST);
    expect(t.total).toBeGreaterThan(g.end);
    const at = (x: number) => poseDistance(sampleCueTimeline(t, x).pose, REST_POSE).pos;
    expect(at(g.end + 0.01)).toBeGreaterThan(0.01); // 区間終端の直後はまだ復帰の途中
    expect(at(t.total)).toBeLessThan(1e-9);
  });
  it('既定サンプル(main.ts の SRT)の全区間で連続', () => {
    const p = planFromText(DEFAULT_SRT, 'auto', { kind: 'caption-wipe' });
    if (!p.ok) throw new Error('bad');
    const m = maxStep(p.timeline);
    expect(m.pos).toBeLessThan(STEP_POS);
    expect(m.ang).toBeLessThan(STEP_ANG);
  });
  it('指文字モードでも連続', () => {
    const p = planFromText('1\n00:00:00,000 --> 00:00:01,000\nあいうえお\n\n2\n00:00:01,000 --> 00:00:02,000\nおえういあ', 'auto', { kind: 'fingerspelling-wipe' });
    if (!p.ok) throw new Error('bad');
    const m = maxStep(p.timeline);
    expect(m.pos).toBeLessThan(STEP_POS);
    expect(m.ang).toBeLessThan(STEP_ANG);
  });
  it('区間終端を越えても待機への復帰が続き、境界で止まらない', () => {
    const d = natural('好き 歌う 食べる');
    const t = ct([{ start: 0, end: d / 1.5, text: '好き 歌う 食べる' }, { start: 20, end: 22, text: '好き' }]);
    const end = t.segments[0].end;
    expect(sampleCueTimeline(t, end + 0.01).phase).toBe('idle');
    expect(poseDistance(sampleCueTimeline(t, end + 0.01).pose, REST_POSE).pos).toBeGreaterThan(0);
    expect(sampleCueTimeline(t, end + RETURN_TO_REST + 0.5).pose).toEqual(REST_POSE);
  });
});

describe('指文字(最小セット)', () => {
  it('あいうえお、kana-fingerspelling・unreviewed・スキーマ検証済み・手話扱いされない・VRM 可動域内', () => {
    expect(FINGERSPELLING_MOTIONS.map((m) => m.semantic.label)).toEqual(['あ', 'い', 'う', 'え', 'お']);
    const p = validateAvatarProfile(vrmJson);
    if (!p.ok) throw new Error('bad');
    for (const m of FINGERSPELLING_MOTIONS) {
      expect(m.category).toBe('kana-fingerspelling');
      expect(m.provenance.status).toBe('unreviewed');
      expect(isReviewedSignLanguage(m)).toBe(false);
      expect(validateMotion(m).ok).toBe(true);
      expect(checkRangeOfMotion(m, p.value), m.id).toEqual([]);
      expect(provenanceBadge(m)).toBe('未監修・指文字');
    }
  });
  it('かな → 1文字ずつ。カタカナ→ひらがな、対応外の文字はまとめて unknown、記号は無視', () => {
    const toks = (s: string) => textToFingerspelling(s).map((i) => `${i.kind === 'motion' ? 'M' : 'U'}${i.token}`);
    expect(toks('あいう')).toEqual(['Mあ', 'Mい', 'Mう']);
    expect(toks('アイ、お！')).toEqual(['Mあ', 'Mい', 'Mお']);
    expect(toks('あかさえ')).toEqual(['Mあ', 'Uかさ', 'Mえ']);
    expect(toks('')).toEqual([]);
    expect(toks('ｱｲ')).toEqual(['Mあ', 'Mい']); // 半角カナは NFKC で全角になる
  });
});

describe('モード判別 union', () => {
  const text = 'ありがとう あいう';
  it('モードごとに語彙変換が分かれる(判別可能 union で網羅)', () => {
    const caption = sequenceForMode({ kind: 'caption-wipe' }, text);
    const finger = sequenceForMode({ kind: 'fingerspelling-wipe' }, text);
    const retarget = sequenceForMode({ kind: 'avatar-retarget', profileId: 'x' }, text);
    expect(caption.filter((i) => i.kind === 'motion').map((i) => i.token)).toEqual(['ありがとう']);
    expect(caption.find((i) => i.kind === 'unknown')?.token).toBe('あいう');
    expect(finger.filter((i) => i.kind === 'motion').map((i) => i.token)).toEqual(['あ', 'う', 'あ', 'い', 'う']);
    expect(finger.filter((i) => i.kind === 'unknown').map((i) => i.token)).toEqual(['りがと']);
    expect(retarget).toEqual(caption);
  });
  it('語彙の身振りは手話風身振り、指文字モードはかな指文字(区分が混ざらない)', () => {
    const cats = (m: Mode) => new Set(sequenceForMode(m, 'あ ありがとう').flatMap((i) => (i.kind === 'motion' ? [i.motion.category] : [])));
    expect([...cats({ kind: 'caption-wipe' })]).toEqual(['sign-like-gesture']);
    expect([...cats({ kind: 'fingerspelling-wipe' })]).toEqual(['kana-fingerspelling']);
  });
  it('指文字モードは短い遷移を使う', () => {
    const p = planFromText('1\n00:00:00,000 --> 00:00:10,000\nあい', 'auto', { kind: 'fingerspelling-wipe' });
    if (!p.ok) throw new Error('bad');
    const [a, b] = p.timeline.segments[0].gestures!.segments;
    expect(b.start - a.end).toBeCloseTo(FINGERSPELLING_TRANSITION);
  });
  it('モード名・説明・形式名のラベルが全モードにある', () => {
    for (const k of ['caption-wipe', 'fingerspelling-wipe', 'avatar-retarget'] as const) {
      expect(MODE_LABELS[k].name.length).toBeGreaterThan(0);
      expect(MODE_LABELS[k].description.length).toBeGreaterThan(0);
      expect(MODE_LABELS[k].name + MODE_LABELS[k].description).not.toMatch(/手話通訳|手話翻訳|手話対応/);
    }
    expect(Object.keys(FORMAT_LABELS).sort()).toEqual(['auto', 'lrc', 'plain', 'srt', 'vtt']);
  });
});

describe('planFromText', () => {
  const srt = '1\n00:00:01,000 --> 00:00:04,000\nありがとう\n\n2\n00:00:05,000 --> 00:00:08,000\nあした\n';
  it('自動判定・パース・身振り列まで通る', () => {
    const p = planFromText(srt, 'auto', { kind: 'caption-wipe' });
    if (!p.ok) throw new Error('bad');
    expect(p.format).toBe('srt');
    expect(p.cues).toHaveLength(2);
    expect(p.timeline.total).toBe(8);
    expect(p.timeline.segments[1].unsupported).toEqual(['あした']);
  });
  it('不正入力は ok:false と行番号つきエラー。明示形式が優先される', () => {
    const p = planFromText('1\n00:00:09,000 --> 00:00:04,000\nx', 'auto', { kind: 'caption-wipe' });
    expect(p).toMatchObject({ ok: false, format: 'srt', errors: [{ line: 2 }] });
    expect(planFromText(srt, 'plain', { kind: 'caption-wipe' })).toMatchObject({ ok: true, format: 'plain' });
  });
});
