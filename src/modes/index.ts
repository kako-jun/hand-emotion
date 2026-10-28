// モード(字幕ワイプ / 指文字ワイプ / アバターリターゲット)の型と、入力テキスト → 再生計画の純粋関数。
// モードは判別可能 union で分け、モードごとの語彙変換・プレビュー構成を取り違えられないようにする。
import { FINGERSPELLING_MOTIONS } from '../text/presets';
import { textToSequence } from '../text/vocabulary';
import type { SequenceItem } from '../text/vocabulary';
import { parseCues, detectFormat } from '../import/cues';
import type { Cue, CueFormat, ParseIssue } from '../import/cues';
import { buildCueTimeline } from '../motion/cueTimeline';
import type { CueTimeline } from '../motion/cueTimeline';
import type { MotionDefinition } from '../types/definition';

/** 字幕ワイプ: 語彙に一致した語の身振り(手話風・未監修)+字幕。未対応語は字幕のみ */
export type CaptionWipeMode = Readonly<{ kind: 'caption-wipe' }>;
/** 指文字ワイプ: かなを1文字ずつ指文字(未監修の最小セット)で出す。対応外の文字は字幕のみ */
export type FingerspellingWipeMode = Readonly<{ kind: 'fingerspelling-wipe' }>;
/** アバターリターゲット: 語彙の身振りを、選んだ骨格(avatar profile)へ流し込んで並べる */
export type AvatarRetargetMode = Readonly<{ kind: 'avatar-retarget'; profileId: string }>;
export type Mode = CaptionWipeMode | FingerspellingWipeMode | AvatarRetargetMode;
export type ModeKind = Mode['kind'];

/** 指文字の語間遷移(秒)。語彙の身振りより短く、1文字ずつ素早くつなぐ */
export const FINGERSPELLING_TRANSITION = 0.15;

const SKIP_CHARS = /[\s、。，．,.!?！？「」『』()（）…・ー〜~♪♡☆★]/u;

/** カタカナをひらがなへ(指文字の引きは平仮名) */
const toHiragana = (s: string): string => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** かなを1文字ずつ指文字にする。対応する指文字がない文字は連続分を1つの unknown にまとめる */
export function textToFingerspelling(text: string, motions: readonly MotionDefinition[] = FINGERSPELLING_MOTIONS): SequenceItem[] {
  const byChar = new Map(motions.map((m) => [m.semantic.label, m]));
  const out: SequenceItem[] = [];
  let unknown = '';
  const flush = (): void => {
    if (unknown) out.push({ kind: 'unknown', token: unknown });
    unknown = '';
  };
  for (const ch of toHiragana(text.normalize('NFKC'))) {
    const m = byChar.get(ch);
    if (m) {
      flush();
      out.push({ kind: 'motion', token: ch, motion: m });
    } else if (SKIP_CHARS.test(ch)) {
      flush();
    } else {
      unknown += ch;
    }
  }
  flush();
  return out;
}

/** モードごとの、キュー本文 → 身振り列の変換 */
export function sequenceForMode(mode: Mode, text: string): SequenceItem[] {
  switch (mode.kind) {
    case 'caption-wipe':
    case 'avatar-retarget':
      return textToSequence(text);
    case 'fingerspelling-wipe':
      return textToFingerspelling(text);
  }
}

const transitionForMode = (mode: Mode): number | undefined => (mode.kind === 'fingerspelling-wipe' ? FINGERSPELLING_TRANSITION : undefined);

export type Plan =
  | Readonly<{ ok: true; format: CueFormat; cues: readonly Cue[]; timeline: CueTimeline }>
  | Readonly<{ ok: false; format: CueFormat; errors: readonly ParseIssue[] }>;

/** 入力テキスト(形式は明示 or 自動判定)とモードから再生計画を作る */
export function planFromText(input: string, format: CueFormat | 'auto', mode: Mode): Plan {
  const f = format === 'auto' ? detectFormat(input) : format;
  const r = parseCues(f, input);
  if (!r.ok) return { ok: false, format: f, errors: r.errors };
  return { ok: true, format: f, cues: r.cues, timeline: buildCueTimeline(r.cues, (t) => sequenceForMode(mode, t), transitionForMode(mode)) };
}
