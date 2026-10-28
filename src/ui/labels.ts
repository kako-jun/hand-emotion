// UI の表示文言。モード名は「指文字/身振り支援」。手話そのものを名乗る文言は置かない。
import type { MotionDefinition } from '../types/definition';
import { isReviewedSignLanguage } from '../validate';
import type { ModeKind } from '../modes';
import type { CueFormat } from '../import/cues';

export const MODE_NAME = '指文字/身振り支援';
export const UNREVIEWED_BADGE = '未監修・手話風身振り';

/** 再生中 motion の区分バッジ。手話として扱ってよいのは jsl かつ監修済みだけ。 */
export function provenanceBadge(m: MotionDefinition): string {
  if (isReviewedSignLanguage(m)) return '監修済み';
  if (m.category === 'kana-fingerspelling') return m.provenance.status === 'reviewed' ? '監修済み・指文字' : '未監修・指文字';
  if (m.category === 'sign-like-gesture') return m.provenance.status === 'reviewed' ? '監修済み・身振り' : UNREVIEWED_BADGE;
  return '未監修・手話風身振り';
}

export const unknownCaption = (token: string): string => `「${token}」は未登録(無動作)`;

/** モードの表示名と説明。手話そのものを名乗る文言は置かない(線引きは docs/spec.md)。 */
export const MODE_LABELS: Readonly<Record<ModeKind, Readonly<{ name: string; description: string }>>> = {
  'caption-wipe': { name: '字幕ワイプ', description: '字幕の語に合う手話風の身振り(未監修)と字幕を出します。登録のない語は字幕のみです。' },
  'fingerspelling-wipe': { name: '指文字ワイプ', description: 'かなを1文字ずつ指文字風の手の形(未監修・あいうえおのみ)で出します。対応外の文字は字幕のみです。' },
  'avatar-retarget': { name: 'アバターリターゲット', description: '語彙の身振りを、選んだ骨格(avatar profile)へ流し込んで並べます。' },
};

export const FORMAT_LABELS: Readonly<Record<CueFormat | 'auto', string>> = {
  auto: '自動判定',
  srt: 'SRT',
  vtt: 'WebVTT',
  lrc: 'LRC',
  plain: 'プレーンテキスト(1行3秒)',
};

export const omittedCaption = (tokens: readonly string[]): string => `速度上限のため身振りを省略(字幕のみ): ${tokens.join(' ')}`;
export const unsupportedCaption = (tokens: readonly string[]): string => `未対応語(字幕のみ): ${tokens.join(' ')}`;

export type ExportKind = 'runtime-json' | 'brief-yaml' | 'brief-markdown';
export const EXPORT_LABELS: Readonly<Record<ExportKind, Readonly<{ name: string; file: string; mime: string }>>> = {
  'runtime-json': { name: 'runtime JSON', file: 'hand-emotion.runtime.json', mime: 'application/json' },
  'brief-yaml': { name: 'retarget 指示書(YAML)', file: 'hand-emotion.retarget-brief.yaml', mime: 'text/yaml' },
  'brief-markdown': { name: '指示書(Markdown)', file: 'hand-emotion.retarget-brief.md', mime: 'text/markdown' },
};
