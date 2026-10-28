// UI の表示文言。モード名は「指文字/身振り支援」。手話そのものを名乗る文言は置かない。
import type { MotionDefinition } from '../types/definition';
import { isReviewedSignLanguage } from '../validate';

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
