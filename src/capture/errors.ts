// カメラ/モデル取得の失敗を種類に分ける。純粋関数(表示文言は src/ui/labels.ts)。
export type CaptureErrorKind = 'unsupported' | 'denied' | 'no-device' | 'in-use' | 'model-unavailable' | 'unknown';

const nameOf = (e: unknown): string => (typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : '');

/** getUserMedia の失敗(DOMException の name で判別) */
export function classifyCameraError(e: unknown): CaptureErrorKind {
  switch (nameOf(e)) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'no-device';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'in-use';
    case 'TypeError':
      return 'unsupported';
    default:
      return 'unknown';
  }
}

/** モデル/wasm の取得や初期化の失敗は、オフライン・ブロックを含めてすべて「モデルを取得できない」として扱う */
export const classifyModelError = (_e: unknown): CaptureErrorKind => 'model-unavailable';

export const errorDetail = (e: unknown): string => (e instanceof Error ? e.message : String(e));
