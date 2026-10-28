// タイムコード付きテキストの取り込み(SRT / VTT / LRC / プレーンテキスト)。Three.js・DOM 非依存の純粋関数。
// 不正な入力は例外にせず、行番号(1始まり)つきのエラー列で返す。

export type Cue = Readonly<{ start: number; end: number; text: string }>;
export type ParseIssue = Readonly<{ line: number; message: string }>;
export type ParseResult = Readonly<{ ok: true; cues: readonly Cue[] }> | Readonly<{ ok: false; errors: readonly ParseIssue[] }>;
export type CueFormat = 'srt' | 'vtt' | 'lrc' | 'plain';

/** プレーンテキストの1行あたりの表示時間(秒) */
export const PLAIN_CUE_DURATION = 3;
/** LRC の最後の行(次の行がない)の表示時間(秒) */
export const LRC_LAST_DURATION = 4;

export const formatIssue = (e: ParseIssue): string => `${e.line}行目: ${e.message}`;

const ok = (cues: Cue[]): ParseResult => ({ ok: true, cues });
const fail = (errors: ParseIssue[]): ParseResult => ({ ok: false, errors });

/** BOM を除き、改行を \n に正規化して行に分ける */
function toLines(input: string): string[] {
  return input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
}

/** 字幕テキスト中のタグ(<i> <c.x> <00:01.000> 等)を除く */
const stripTags = (s: string): string => s.replace(/<[^>]*>/g, '');

const sortCues = (cues: Cue[]): Cue[] => cues.map((c, i) => ({ c, i })).sort((a, b) => a.c.start - b.c.start || a.i - b.i).map((x) => x.c);

/** [h:]mm:ss(.|,)fff を秒に。不正なら null(分・秒は 60 未満、小数は 1〜3 桁、hours 必須か任意かは引数) */
function parseClock(s: string, hoursRequired: boolean): number | null {
  const m = /^(?:(\d+):)?(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(s);
  if (!m) return null;
  if (hoursRequired && m[1] === undefined) return null;
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (min >= 60 || sec >= 60) return null;
  const frac = m[4] ? Number(m[4].padEnd(3, '0')) / 1000 : 0;
  return Number(m[1] ?? 0) * 3600 + min * 60 + sec + frac;
}

/** `start --> end [settings]` を解釈する。解釈できなければエラー文字列 */
function parseTimingLine(line: string, hoursRequired: boolean): { start: number; end: number } | string {
  const m = /^\s*(\S+)\s*-->\s*(\S+)(?:\s.*)?$/.exec(line);
  if (!m) return `時刻行の形式が不正です: ${line.trim()}`;
  const start = parseClock(m[1], hoursRequired);
  if (start === null) return `不正な開始時刻です: ${m[1]}`;
  const end = parseClock(m[2], hoursRequired);
  if (end === null) return `不正な終了時刻です: ${m[2]}`;
  if (end <= start) return `終了時刻が開始時刻以前です: ${m[1]} --> ${m[2]}`;
  return { start, end };
}

/** 空行区切りのブロックに分ける(各ブロックは先頭の行番号つき) */
function toBlocks(lines: readonly string[], from: number): { first: number; lines: string[] }[] {
  const blocks: { first: number; lines: string[] }[] = [];
  let cur: { first: number; lines: string[] } | null = null;
  for (let i = from; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      cur = null;
      continue;
    }
    if (!cur) {
      cur = { first: i + 1, lines: [] };
      blocks.push(cur);
    }
    cur.lines.push(lines[i]);
  }
  return blocks;
}

export function parseSrt(input: string): ParseResult {
  const lines = toLines(input);
  const cues: Cue[] = [];
  const errors: ParseIssue[] = [];
  for (const b of toBlocks(lines, 0)) {
    let k = 0;
    if (/^\d+$/.test(b.lines[0].trim()) && b.lines.length > 1) k = 1;
    if (!b.lines[k].includes('-->')) {
      errors.push({ line: b.first + k, message: `時刻行(開始 --> 終了)がありません: ${b.lines[k].trim()}` });
      continue;
    }
    const t = parseTimingLine(b.lines[k], true);
    if (typeof t === 'string') {
      errors.push({ line: b.first + k, message: t });
      continue;
    }
    cues.push({ ...t, text: stripTags(b.lines.slice(k + 1).join('\n')).trim() });
  }
  if (errors.length) return fail(errors);
  if (cues.length === 0) return fail([{ line: 1, message: 'キューが見つかりません' }]);
  return ok(sortCues(cues));
}

export function parseVtt(input: string): ParseResult {
  const lines = toLines(input);
  if (!/^WEBVTT(?:[ \t].*)?$/.test(lines[0])) return fail([{ line: 1, message: 'WEBVTT ヘッダがありません' }]);
  const cues: Cue[] = [];
  const errors: ParseIssue[] = [];
  // 1行目(ヘッダ)に続く最初の空行までもヘッダ扱い
  const blocks = toBlocks(lines, 1);
  const headerEnd = lines.findIndex((l, i) => i > 0 && l.trim() === '');
  for (const b of blocks) {
    if (headerEnd === -1 || b.first - 1 < headerEnd) continue;
    if (/^(NOTE|STYLE|REGION)(?:[ \t]|$)/.test(b.lines[0])) continue;
    let k = 0;
    if (!b.lines[0].includes('-->') && b.lines.length > 1) k = 1;
    if (!b.lines[k].includes('-->')) {
      errors.push({ line: b.first + k, message: `時刻行(開始 --> 終了)がありません: ${b.lines[k].trim()}` });
      continue;
    }
    const t = parseTimingLine(b.lines[k], false);
    if (typeof t === 'string') {
      errors.push({ line: b.first + k, message: t });
      continue;
    }
    cues.push({ ...t, text: stripTags(b.lines.slice(k + 1).join('\n')).trim() });
  }
  if (errors.length) return fail(errors);
  if (cues.length === 0) return fail([{ line: 1, message: 'キューが見つかりません' }]);
  return ok(sortCues(cues));
}

/** LRC のタイムスタンプ mm:ss[.xx](分は 2 桁以上可、小数は 1〜3 桁の小数部) */
function parseLrcStamp(s: string): number | null {
  const m = /^(\d+):(\d{2})(?:[.:](\d{1,3}))?$/.exec(s);
  if (!m) return null;
  const sec = Number(m[2]);
  if (sec >= 60) return null;
  return Number(m[1]) * 60 + sec + (m[3] ? Number(`0.${m[3]}`) : 0);
}

export function parseLrc(input: string): ParseResult {
  const lines = toLines(input);
  const errors: ParseIssue[] = [];
  let offset = 0; // 秒。正の値は歌詞を早める([offset:+500] = 0.5 秒早く)
  const entries: { time: number; text: string }[] = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === '') return;
    const no = i + 1;
    const off = /^\[offset:\s*([+-]?\d+)\s*\]$/i.exec(line);
    if (off) {
      offset = Number(off[1]) / 1000;
      return;
    }
    if (/^\[offset:/i.test(line)) {
      errors.push({ line: no, message: `offset はミリ秒の整数で指定してください: ${line}` });
      return;
    }
    // メタ情報タグ [ar:..] [ti:..] 等は読み飛ばす
    if (/^\[[A-Za-z]+:[^\]]*\]$/.test(line)) return;
    const stamps: number[] = [];
    let rest = line;
    for (;;) {
      const m = /^\[([^\]]*)\]/.exec(rest);
      if (!m) break;
      const t = parseLrcStamp(m[1]);
      if (t === null) {
        errors.push({ line: no, message: `不正なタイムスタンプです: [${m[1]}]` });
        return;
      }
      stamps.push(t);
      rest = rest.slice(m[0].length);
    }
    if (stamps.length === 0) {
      errors.push({ line: no, message: `タイムスタンプがありません: ${line}` });
      return;
    }
    const text = stripTags(rest).trim();
    for (const t of stamps) entries.push({ time: Math.max(0, t - offset), text });
  });
  if (errors.length) return fail(errors);
  const sorted = entries.map((e, i) => ({ e, i })).sort((a, b) => a.e.time - b.e.time || a.i - b.i).map((x) => x.e);
  const cues: Cue[] = [];
  sorted.forEach((e, i) => {
    if (e.text === '') return; // 空行は直前の歌詞の終端マーカー
    const next = sorted.slice(i + 1).find((n) => n.time > e.time);
    cues.push({ start: e.time, end: next ? next.time : e.time + LRC_LAST_DURATION, text: e.text });
  });
  if (cues.length === 0) return fail([{ line: 1, message: 'キューが見つかりません' }]);
  return ok(cues);
}

/** 空でない各行を、固定長(PLAIN_CUE_DURATION)のキューとして順に並べる。空入力は空列 */
export function parsePlain(input: string): ParseResult {
  const cues: Cue[] = [];
  for (const line of toLines(input)) {
    const text = line.trim();
    if (text === '') continue;
    const start = cues.length * PLAIN_CUE_DURATION;
    cues.push({ start, end: start + PLAIN_CUE_DURATION, text });
  }
  return ok(cues);
}

/** 内容から形式を推定する(WEBVTT ヘッダ → VTT、`-->` → SRT、`[mm:ss` → LRC、他はプレーン) */
export function detectFormat(input: string): CueFormat {
  const s = input.replace(/^\uFEFF/, '');
  if (/^WEBVTT(?:[ \t\r\n]|$)/.test(s)) return 'vtt';
  if (s.includes('-->')) return 'srt';
  if (/^\s*\[\d+:\d{2}/m.test(s)) return 'lrc';
  return 'plain';
}

export function parseCues(format: CueFormat, input: string): ParseResult {
  switch (format) {
    case 'srt':
      return parseSrt(input);
    case 'vtt':
      return parseVtt(input);
    case 'lrc':
      return parseLrc(input);
    case 'plain':
      return parsePlain(input);
  }
}
