import { describe, expect, it } from 'vitest';
import { LRC_LAST_DURATION, PLAIN_CUE_DURATION, detectFormat, formatIssue, parseCues, parseLrc, parsePlain, parseSrt, parseVtt } from '../src/import/cues';
import type { ParseResult } from '../src/import/cues';

const cuesOf = (r: ParseResult) => {
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.errors)}`);
  return r.cues;
};
const errsOf = (r: ParseResult) => {
  if (r.ok) throw new Error('expected errors');
  return r.errors;
};

describe('SRT', () => {
  const srt = '1\n00:00:01,000 --> 00:00:03,500\nこんにちは\n\n2\n00:01:02,250 --> 01:00:00,000\n好き\n歌う\n';
  it('正常系: 時刻・複数行', () => {
    expect(cuesOf(parseSrt(srt))).toEqual([
      { start: 1, end: 3.5, text: 'こんにちは' },
      { start: 62.25, end: 3600, text: '好き\n歌う' },
    ]);
  });
  it('BOM・CRLF・CR・末尾空行なし・連続空行', () => {
    const v = '\uFEFF' + srt.replace(/\n/g, '\r\n').replace('\r\n\r\n', '\r\n\r\n\r\n');
    expect(cuesOf(parseSrt(v))).toEqual(cuesOf(parseSrt(srt)));
    expect(cuesOf(parseSrt(srt.replace(/\n/g, '\r')))).toEqual(cuesOf(parseSrt(srt)));
  });
  it('番号なし・ピリオド小数・タグ除去・開始順に整列', () => {
    const r = cuesOf(parseSrt('00:00:05.5 --> 00:00:06\n<i>後</i>\n\n00:00:01,0 --> 00:00:02,0\n先'));
    expect(r.map((c) => c.text)).toEqual(['先', '後']);
  });
  it('不正時刻は行番号つきエラー(分・秒の範囲外、形式、終了<=開始、時刻行なし)', () => {
    expect(errsOf(parseSrt('1\n00:00:01,000 --> 00:00:03,500\nok\n\n2\n00:61:00,000 --> 01:00:00,000\nx'))[0].line).toBe(6);
    expect(errsOf(parseSrt('1\n00:00:61,000 --> 00:01:00,000\nx'))[0].line).toBe(2);
    expect(errsOf(parseSrt('1\n00:00:02,000 --> 00:00:02,000\nx'))[0].message).toMatch(/以前/);
    expect(errsOf(parseSrt('1\n00:00:03,000 --> 00:00:02,000\nx'))).toHaveLength(1);
    expect(errsOf(parseSrt('1\n1:2:3 --> 4\nx'))[0].line).toBe(2);
    expect(errsOf(parseSrt('1\nいつか\nx'))[0].line).toBe(2);
    expect(errsOf(parseSrt('12'))[0].line).toBe(1);
    expect(errsOf(parseSrt('01:00,000 --> 02:00,000\nx'))[0].line).toBe(1); // SRT は時が必須
  });
  it('複数のエラーを全部返す。キューなしはエラー', () => {
    expect(errsOf(parseSrt('1\nbad\nx\n\n2\nbad2\ny')).map((e) => e.line)).toEqual([2, 6]);
    expect(errsOf(parseSrt('')).length).toBe(1);
    expect(formatIssue({ line: 3, message: 'm' })).toBe('3行目: m');
  });
});

describe('WebVTT', () => {
  const vtt = 'WEBVTT - title\nKind: captions\n\nNOTE comment\nmore note\n\nSTYLE\n::cue{color:red}\n\nintro\n00:01.000 --> 00:03.000 align:start position:10%\nこんにちは\n\n01:00:00.500 --> 01:00:02.000\n<v A>好き</v>\n歌う\n';
  it('ヘッダ・NOTE・STYLE・識別子・cue 設定・分:秒形式・複数行・タグ除去', () => {
    expect(cuesOf(parseVtt(vtt))).toEqual([
      { start: 1, end: 3, text: 'こんにちは' },
      { start: 3600.5, end: 3602, text: '好き\n歌う' },
    ]);
  });
  it('BOM・CRLF', () => {
    expect(cuesOf(parseVtt('\uFEFF' + vtt.replace(/\n/g, '\r\n')))).toEqual(cuesOf(parseVtt(vtt)));
  });
  it('WEBVTT ヘッダなしはエラー(1行目)', () => {
    expect(errsOf(parseVtt('00:01.000 --> 00:02.000\nx'))).toEqual([{ line: 1, message: expect.stringMatching(/WEBVTT/) }]);
    expect(errsOf(parseVtt('WEBVTTX\n\n00:01.000 --> 00:02.000\nx'))[0].line).toBe(1);
  });
  it('不正時刻は行番号つき(識別子行の分だけずれない)', () => {
    expect(errsOf(parseVtt('WEBVTT\n\nid\n00:01.000 --> 00:99.000\nx'))[0].line).toBe(4);
    expect(errsOf(parseVtt('WEBVTT\n\n00:03.000 --> 00:01.000\nx'))[0].line).toBe(3);
    expect(errsOf(parseVtt('WEBVTT\n\n1:00 --> 2:00\nx'))[0].line).toBe(3);
  });
  it('NOTE だけ・cue なしはエラー、NOTE の中の --> は cue にならない', () => {
    expect(errsOf(parseVtt('WEBVTT\n\nNOTE\n00:01.000 --> 00:02.000')).length).toBe(1);
  });
});

describe('LRC', () => {
  it('基本: 行の終了は次の行の開始、最後は既定の長さ', () => {
    const r = cuesOf(parseLrc('[ti:歌]\n[ar:誰か]\n[00:01.00]こんにちは\n[00:05.50]好き\n'));
    expect(r).toEqual([
      { start: 1, end: 5.5, text: 'こんにちは' },
      { start: 5.5, end: 5.5 + LRC_LAST_DURATION, text: '好き' },
    ]);
  });
  it('複数タイムスタンプは行を複製し、全体を時刻順に並べる', () => {
    const r = cuesOf(parseLrc('[00:10.00][00:30.00]サビ\n[00:20.00]間奏A\n'));
    expect(r.map((c) => [c.start, c.text])).toEqual([[10, 'サビ'], [20, '間奏A'], [30, 'サビ']]);
    expect(r[0].end).toBe(20);
  });
  it('offset: 正は早める、負は遅らせる、0 未満は 0 に丸める', () => {
    expect(cuesOf(parseLrc('[offset:+500]\n[00:02.00]a\n[00:00.20]b'))[0]).toEqual({ start: 0, end: 1.5, text: 'b' });
    expect(cuesOf(parseLrc('[offset:-500]\n[00:02.00]a'))[0].start).toBe(2.5);
  });
  it('空行テキストは直前の終端になり、キューにならない。小数桁ゆれ・分3桁', () => {
    const r = cuesOf(parseLrc('[00:01.5]a\n[00:03]\n[100:00.123]b'));
    expect(r).toEqual([
      { start: 1.5, end: 3, text: 'a' },
      { start: 6000.123, end: 6000.123 + LRC_LAST_DURATION, text: 'b' },
    ]);
  });
  it('エンハンスド(<mm:ss.xx>)タグは除く。BOM・CRLF', () => {
    expect(cuesOf(parseLrc('\uFEFF[00:01.00]<00:01.00>は<00:01.50>い\r\n'))[0].text).toBe('はい');
  });
  it('不正は行番号つきエラー(秒>=60・非数・offset 不正・タイムスタンプなし)', () => {
    expect(errsOf(parseLrc('[00:01.00]ok\n[00:75.00]x'))[0].line).toBe(2);
    expect(errsOf(parseLrc('[00:1x.00]x'))[0].line).toBe(1);
    expect(errsOf(parseLrc('[offset:abc]\n[00:01.00]x'))[0].line).toBe(1);
    expect(errsOf(parseLrc('[00:01.00]a\n時刻のない行'))[0].line).toBe(2);
    expect(errsOf(parseLrc('[ti:x]\n')).length).toBe(1);
  });
});

describe('プレーンテキスト', () => {
  it('空行を飛ばし、各行を固定長で順に並べる。BOM・CRLF', () => {
    const r = cuesOf(parsePlain('\uFEFFa\r\n\r\n  b  \r\nc'));
    expect(r).toEqual([
      { start: 0, end: PLAIN_CUE_DURATION, text: 'a' },
      { start: PLAIN_CUE_DURATION, end: PLAIN_CUE_DURATION * 2, text: 'b' },
      { start: PLAIN_CUE_DURATION * 2, end: PLAIN_CUE_DURATION * 3, text: 'c' },
    ]);
  });
  it('空入力は空列', () => {
    expect(cuesOf(parsePlain(''))).toEqual([]);
    expect(cuesOf(parsePlain(' \n\n'))).toEqual([]);
  });
});

describe('形式の判定と振り分け', () => {
  it('detectFormat', () => {
    expect(detectFormat('\uFEFFWEBVTT\n\n00:01.000 --> 00:02.000\nx')).toBe('vtt');
    expect(detectFormat('1\n00:00:01,000 --> 00:00:02,000\nx')).toBe('srt');
    expect(detectFormat('[ti:x]\n[00:01.00]x')).toBe('lrc');
    expect(detectFormat('ただの文')).toBe('plain');
  });
  it('parseCues は形式ごとのパーサに振り分ける', () => {
    expect(parseCues('plain', 'a').ok).toBe(true);
    expect(parseCues('srt', 'a').ok).toBe(false);
    expect(parseCues('vtt', 'a').ok).toBe(false);
    expect(parseCues('lrc', 'a').ok).toBe(false);
  });
});

describe('追加の境界(巨大値・offset 位置・桁・REGION・同時刻)', () => {
  const big = '9'.repeat(400);
  it('巨大数値の時刻は Infinity で通さず、行番号つきエラー', () => {
    expect(errsOf(parseSrt(`1\n00:00:01,000 --> ${big}:00:00,000\nx`))[0]).toMatchObject({ line: 2 });
    expect(errsOf(parseSrt(`1\n${big}:00:00,000 --> 00:00:01,000\nx`))[0].line).toBe(2);
    expect(errsOf(parseVtt(`WEBVTT\n\n${big}:00:00.000 --> 00:00:01.000\nx`))[0].line).toBe(3);
    expect(errsOf(parseLrc(`[00:01.00]a\n[${big}:00.00]b`))[0].line).toBe(2);
    expect(errsOf(parseLrc(`[offset:${big}]\n[00:01.00]a`))[0].line).toBe(1);
  });
  it('上限(99時間)ちょうどは通り、超えるとエラー', () => {
    expect(cuesOf(parseSrt('1\n98:59:59,000 --> 99:00:00,000\nx'))[0].end).toBe(99 * 3600);
    expect(errsOf(parseSrt('1\n100:00:00,000 --> 100:00:01,000\nx'))[0].line).toBe(2);
  });
  it('LRC の offset は置かれた位置(末尾・途中)に関わらず全行に効く', () => {
    const tail = cuesOf(parseLrc('[00:02.00]a\n[00:04.00]b\n[offset:+500]'));
    expect(tail.map((c) => c.start)).toEqual([1.5, 3.5]);
    expect(cuesOf(parseLrc('[00:02.00]a\n[offset:+500]\n[00:04.00]b')).map((c) => c.start)).toEqual([1.5, 3.5]);
  });
  it('分が60以上・秒が60以上はそれぞれ単独でエラー', () => {
    expect(errsOf(parseSrt('1\n00:60:00,000 --> 02:00:00,000\nx'))[0].line).toBe(2);
    expect(errsOf(parseSrt('1\n00:00:60,000 --> 00:02:00,000\nx'))[0].line).toBe(2);
    expect(errsOf(parseLrc('[00:60.00]x'))[0].line).toBe(1);
  });
  it('小数部は桁数でなく小数として読む(,5 = 0.5 秒、.25 = 0.25 秒)', () => {
    expect(cuesOf(parseSrt('1\n00:00:01,5 --> 00:00:03,25\nx'))[0]).toMatchObject({ start: 1.5, end: 3.25 });
    expect(cuesOf(parseVtt('WEBVTT\n\n00:01.5 --> 00:03.05\nx'))[0]).toMatchObject({ start: 1.5, end: 3.05 });
  });
  it('VTT の REGION ブロックは読み飛ばす', () => {
    expect(cuesOf(parseVtt('WEBVTT\n\nREGION\nid:fred\nwidth:40%\n\n00:01.000 --> 00:02.000\nx'))).toEqual([{ start: 1, end: 2, text: 'x' }]);
  });
  it('LRC の同時刻2行は、どちらも次の「より遅い」行まで続く(幅0にならない)', () => {
    expect(cuesOf(parseLrc('[00:01.00]a\n[00:01.00]b\n[00:03.00]c'))).toEqual([
      { start: 1, end: 3, text: 'a' },
      { start: 1, end: 3, text: 'b' },
      { start: 3, end: 3 + LRC_LAST_DURATION, text: 'c' },
    ]);
  });
});

