// テキスト → プリセット列。語彙一致のみ(形態素解析はしない)。未知語は無動作で字幕だけ出す。
import type { MotionDefinition } from '../types/definition';
import { PRESET_MOTIONS } from './presets';

export type VocabEntry = Readonly<{ motion: MotionDefinition; keys: readonly string[] }>;
export type SequenceItem =
  | Readonly<{ kind: 'motion'; token: string; motion: MotionDefinition }>
  | Readonly<{ kind: 'unknown'; token: string }>;

/** motion id -> 一致させる表記(label / reading に加えた表記ゆれ・語幹) */
const EXTRA_KEYS: Readonly<Record<string, readonly string[]>> = {
  'arigatou.sign-like': ['ありがと', 'ありがとー'],
  'suki.sign-like': ['好', 'すき'],
  'taberu.sign-like': ['食べ', 'たべ'],
  'utau.sign-like': ['歌', 'うた'],
};

export function buildVocabulary(motions: readonly MotionDefinition[]): readonly VocabEntry[] {
  return motions.map((motion) => {
    const keys = new Set<string>([motion.semantic.label, ...(motion.semantic.reading ? [motion.semantic.reading] : []), ...(EXTRA_KEYS[motion.id] ?? [])]);
    return { motion, keys: [...keys] };
  });
}

export const DEFAULT_VOCABULARY: readonly VocabEntry[] = buildVocabulary(PRESET_MOTIONS);

const DELIMITER = /[\s、。，．,.!?！？「」『』()（）\-ー〜~…・]/u;

export function textToSequence(text: string, vocab: readonly VocabEntry[] = DEFAULT_VOCABULARY): SequenceItem[] {
  const src = text.normalize('NFKC');
  // 長い表記を優先して一致させる
  const keys = vocab.flatMap((e) => e.keys.map((k) => ({ k: k.normalize('NFKC'), e }))).sort((a, b) => b.k.length - a.k.length);
  const out: SequenceItem[] = [];
  let unknown = '';
  const flush = (): void => {
    if (unknown) out.push({ kind: 'unknown', token: unknown });
    unknown = '';
  };
  let i = 0;
  while (i < src.length) {
    const hit = keys.find(({ k }) => src.startsWith(k, i));
    if (hit) {
      flush();
      out.push({ kind: 'motion', token: hit.k, motion: hit.e.motion });
      i += hit.k.length;
    } else if (DELIMITER.test(src[i])) {
      flush();
      i += 1;
    } else {
      unknown += src[i];
      i += 1;
    }
  }
  flush();
  return out;
}
