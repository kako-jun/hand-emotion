// テキスト → プリセット列。語彙一致のみ(形態素解析はしない)。未知語は無動作で字幕だけ出す。
import type { MotionDefinition } from '../types/definition';
import { PRESET_MOTIONS } from './presets';

export type VocabEntry = Readonly<{ motion: MotionDefinition; keys: readonly string[] }>;
export type SequenceItem =
  | Readonly<{ kind: 'motion'; token: string; motion: MotionDefinition }>
  | Readonly<{ kind: 'unknown'; token: string }>;

/** motion id -> 一致させる表記(label / reading に加えた表記ゆれ・活用形。1〜2文字の語幹は誤爆するので置かない) */
const EXTRA_KEYS: Readonly<Record<string, readonly string[]>> = {
  'arigatou.sign-like': ['ありがと', 'ありがとー'],
  'suki.sign-like': ['好きな', '好きだ', '好きです', '好きよ', '好きね', '好きで', 'すきな', 'すきだ', 'すきです', 'すきよ', 'すきね', 'すきで'],
  'taberu.sign-like': ['食べた', '食べて', '食べます', '食べない', '食べるよ', '食べるね', '食べるの', 'たべるよ', 'たべるね', 'たべるの', 'たべた', 'たべて', 'たべます', 'たべない'],
  'utau.sign-like': ['歌った', '歌って', '歌います', '歌わない', '歌うよ', '歌うね', '歌うの', 'うたうよ', 'うたうね', 'うたうの', 'うたった', 'うたって', 'うたいます', 'うたわない'],
};

export function buildVocabulary(motions: readonly MotionDefinition[]): readonly VocabEntry[] {
  return motions.map((motion) => {
    const keys = new Set<string>([motion.semantic.label, ...(motion.semantic.reading ? [motion.semantic.reading] : []), ...(EXTRA_KEYS[motion.id] ?? [])]);
    return { motion, keys: [...keys] };
  });
}

export const DEFAULT_VOCABULARY: readonly VocabEntry[] = buildVocabulary(PRESET_MOTIONS);

/** 実行時に語彙へ録画 motion を足す(同じ id は置き換え)。利用者の語を先頭に置き、同じ長さの表記では既存の語彙より先に一致させる。元の語彙は書き換えない。 */
export function addMotionToVocabulary(vocab: readonly VocabEntry[], motion: MotionDefinition): readonly VocabEntry[] {
  const [entry] = buildVocabulary([motion]);
  return [entry, ...vocab.filter((e) => e.motion.id !== motion.id)];
}

const DELIMITER = /[\s、。，．,.!?！？「」『』()（）…・]/u;
/** 語の直後に付く装飾(長音・波線・記号・小さい「っ」)。語尾として読み飛ばし、短い表記の境界にもなる。区切りではない(「ラーメン」「a-b」を割らない) */
const TAIL = /[ー〜~♪♡☆★っッ]/u;

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
  // 位置 j から始まる語彙が、それ自体で一致できるか(2文字以下の表記は、直後が境界のときだけ一致できる)
  // 位置ごとにメモ化する(1〜2 文字の表記が重なると canMatchAt と atBoundary が相互再帰して指数時間になるため)
  const memo = new Map<number, boolean>();
  const canMatchAt = (j: number): boolean => {
    const hit = memo.get(j);
    if (hit !== undefined) return hit;
    const r = keys.some(({ k }) => src.startsWith(k, j) && (k.length > 2 || atBoundary(j + k.length)));
    memo.set(j, r);
    return r;
  };
  // 境界: 文末・区切り・装飾(TAIL)・一致できる別の語彙の開始(「すきやき」の「すき」は境界がなく一致しない)
  const atBoundary = (j: number): boolean => j >= src.length || DELIMITER.test(src[j]) || TAIL.test(src[j]) || canMatchAt(j);
  let i = 0;
  while (i < src.length) {
    const hit = keys.find(({ k }) => src.startsWith(k, i) && (k.length > 2 || atBoundary(i + k.length)));
    if (hit) {
      flush();
      out.push({ kind: 'motion', token: hit.k, motion: hit.e.motion });
      i += hit.k.length;
      while (i < src.length && TAIL.test(src[i])) i += 1;
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
