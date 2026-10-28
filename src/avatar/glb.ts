// .vrm(GLB)のヘッダと JSON チャンクだけを読み、VRM 1.0 かどうかと humanoid ボーン名を取り出す。
// DOM / Three.js 非依存の純粋関数。読み込み(three-vrm)の前に呼び、対象外を行つきのエラーで弾く。
// VRM 0.x(拡張名 `VRM`)は対象外。

export type VrmInspection =
  | Readonly<{ ok: true; humanBones: readonly string[]; name: string | undefined }>
  | Readonly<{ ok: false; code: 'not-glb' | 'invalid' | 'not-vrm' | 'vrm0' | 'unsupported-version' | 'no-humanoid'; errors: readonly string[] }>;

const fail = (code: Extract<VrmInspection, { ok: false }>['code'], ...errors: string[]): VrmInspection => ({ ok: false, code, errors });

const MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK = 0x4e4f534a; // 'JSON'

export function inspectVrmGlb(input: ArrayBuffer | Uint8Array): VrmInspection {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== MAGIC) return fail('not-glb', 'GLB ではありません(先頭が glTF ではない)。.vrm(VRM 1.0)を選んでください');
  if (view.getUint32(4, true) !== 2) return fail('not-glb', `glTF バージョン ${view.getUint32(4, true)} は未対応です(2 のみ)`);
  const chunkLen = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK || 20 + chunkLen > bytes.byteLength) return fail('invalid', 'GLB の JSON チャンクが読めません(壊れたファイル)');
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + chunkLen)));
  } catch {
    return fail('invalid', 'GLB の JSON チャンクを解析できません(壊れたファイル)');
  }
  const ext = (json as { extensions?: Record<string, unknown> } | null)?.extensions;
  if (!ext || typeof ext !== 'object') return fail('not-vrm', 'VRM ではありません(拡張 VRMC_vrm がない普通の glTF)');
  const vrm1 = ext['VRMC_vrm'] as { specVersion?: unknown; humanoid?: { humanBones?: Record<string, unknown> }; meta?: { name?: unknown } } | undefined;
  if (!vrm1) {
    if (ext['VRM']) return fail('vrm0', 'VRM 0.x は未対応です(VRM 1.0 の .vrm を選んでください)');
    return fail('not-vrm', 'VRM ではありません(拡張 VRMC_vrm がない)');
  }
  if (typeof vrm1.specVersion !== 'string' || !vrm1.specVersion.startsWith('1.')) return fail('unsupported-version', `VRMC_vrm specVersion ${String(vrm1.specVersion)} は未対応です(1.x のみ)`);
  const hb = vrm1.humanoid?.humanBones;
  if (!hb || typeof hb !== 'object') return fail('no-humanoid', 'VRMC_vrm.humanoid.humanBones がありません(ヒューマノイド定義の欠落)');
  const humanBones = Object.keys(hb).filter((k) => hb[k] && typeof (hb[k] as { node?: unknown }).node === 'number');
  return { ok: true, humanBones, name: typeof vrm1.meta?.name === 'string' ? vrm1.meta.name : undefined };
}
