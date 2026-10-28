// UI の表示文言。モード名は「指文字/身振り支援」。手話そのものを名乗る文言は置かない。
import type { MotionDefinition } from '../types/definition';
import { isReviewedSignLanguage } from '../validate';
import type { ModeKind } from '../modes';
import type { CueFormat } from '../import/cues';
import type { CaptureErrorKind } from '../capture/errors';
import type { CaptureWarning } from '../capture/types';

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

const SIDE_JA = { left: '左', right: '右' } as const;
const sidesJa = (sides: readonly ('left' | 'right')[]): string => sides.map((s) => SIDE_JA[s]).join('・');
/** VRM 適用時の注意(表示用)。肩/肘の指定は IK 優先で適用しない / 手首が届かず腕を伸ばしきった */
export function vrmApplyNotes(r: Readonly<{ unreachable: readonly ('left' | 'right')[]; armOverridden: readonly ('left' | 'right')[] }>): string {
  return [
    r.armOverridden.length ? `肩/肘の指定は IK 優先で未適用(${sidesJa(r.armOverridden)})` : '',
    r.unreachable.length ? `手首が届かず腕を伸ばしきり(${sidesJa(r.unreachable)})` : '',
  ].filter(Boolean).join(' / ');
}

// --- 録画(Phase 4b)---

export const REC_TITLE = '録画(自分の手を動きにする)';
export const REC_NOTICE = '映像はこのブラウザ内だけで処理し、保存も送信もしません(記録するのは手のランドマークの数値だけです)。録画した動きは未監修の手話風身振りとして扱います。';
export const REC_MODEL_NOTE = '初回は手の検出モデル(MediaPipe Hand Landmarker)を Google の配布 URL から取得します。ライブラリの利用統計の送信はブラウザの CSP で遮断しています(映像は送られません)。';
export const REC_VOCAB_NOTE = '語彙への追加はこのページを開いている間だけ有効です(自動保存しません)。残したいときは JSON をダウンロードしてください。';

export const CAPTURE_ERROR_LABELS: Readonly<Record<CaptureErrorKind, string>> = {
  unsupported: 'このブラウザ/接続ではカメラを使えません(https または localhost で開いてください)。',
  denied: 'カメラの使用が許可されませんでした。ブラウザのアドレスバー付近でカメラを許可してから、もう一度お試しください。',
  'no-device': 'カメラが見つかりません。接続されているか確認してください。',
  'in-use': 'カメラを開始できません(他のアプリが使用中の可能性があります)。',
  'model-unavailable': '手の検出モデルを取得できませんでした(オフライン、またはネットワークがブロックしている可能性があります)。接続を確認してもう一度お試しください。',
  unknown: 'カメラまたは検出の開始に失敗しました。',
};

export const REC_STATUS = {
  idle: 'カメラは止まっています',
  loading: 'カメラとモデルを準備中…',
  ready: '準備完了(録画できます)',
  recording: '録画中…',
  stopped: '録画を止めました',
  noFrames: '録画できたフレームがありません',
} as const;

export const detectionLabel = (sides: readonly ('left' | 'right')[]): string => (sides.length === 0 ? '手は検出されていません(検出なし)' : `検出: ${sides.map((s) => (s === 'left' ? '左手' : '右手')).join('・')}`);

const SIDE = { left: '左', right: '右' } as const;
/** 録画の警告 1 行(表示用)。可動域外は clamp せず、範囲と実測の範囲を示す */
export function captureWarningLine(w: CaptureWarning): string {
  switch (w.kind) {
    case 'range':
      return `可動域外(${SIDE[w.side]} ${w.joint} ${w.axis}): ${w.count} キーフレームで ${w.min}〜${w.max}°(範囲 ${w.limit[0]}〜${w.limit[1]}°)。値はそのまま残しています`;
    case 'dropped-hand':
      return `${SIDE[w.side]}手は ${w.frames} フレームしか検出されず、使いませんでした`;
    case 'duplicate-side':
      return `${SIDE[w.side]}手が同時に複数検出されました(${w.frames} フレーム。スコアの高い方を使用)`;
    case 'outliers':
      return `${SIDE[w.side]}手の外れ値 ${w.frames} フレームを除いて補間しました`;
    case 'long-gap':
      return `${SIDE[w.side]}手が ${w.seconds} 秒間検出されず、その区間は補間していません(再生では前後の姿勢の間をつなぎます)`;
  }
}
