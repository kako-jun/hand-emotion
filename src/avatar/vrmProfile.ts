// VRM 1.0 の humanoid ボーン名の集合 -> avatar profile。Three.js / DOM 非依存の純粋関数。
// ボーン名の対応表は samples/vrm1-humanoid.avatar-profile.json を正本として再利用する(二重管理しない)。
// 判定: 左右の手首(hand)が必須。全指ボーン(30個)が揃えば `full`、欠けていれば `gesture-only`。
//   肩・肘(upperArm / lowerArm)・顔(head / jaw)は任意で、あるものだけ profile に入れる。
// VRM 0.x は対象外(glb.ts が弾く)。VRM の normalized humanoid は常に T-pose なので restPoseCorrection は出さない。
import vrmTable from '../../samples/vrm1-humanoid.avatar-profile.json';
import { validateAvatarProfile } from '../validate';
import type { AvatarProfile, FingerJoint, Side, SideBones } from '../types/definition';

export type VrmProfileResult =
  | Readonly<{ ok: true; profile: AvatarProfile; /** 判定の根拠・足りない任意ボーン */ notes: readonly string[]; missingFingers: readonly string[] }>
  | Readonly<{ ok: false; errors: readonly string[] }>;

type Table = typeof vrmTable.bones.left;

export function generateVrmProfile(humanBones: Iterable<string>, opts: Readonly<{ id?: string }> = {}): VrmProfileResult {
  const have = new Set(humanBones);
  const errors: string[] = [];
  const notes: string[] = [];
  const missingFingers: string[] = [];
  const sides = {} as Record<Side, SideBones>;
  for (const side of ['left', 'right'] as const) {
    const t: Table = vrmTable.bones[side];
    if (!have.has(t.wrist)) {
      errors.push(`ヒューマノイド欠落: ${t.wrist}(${side === 'left' ? '左' : '右'}手首)がありません。手首は必須です`);
      continue;
    }
    const fingers: Partial<Record<FingerJoint, string>> = {};
    for (const [joint, bone] of Object.entries(t.fingers) as [FingerJoint, string][]) {
      if (have.has(bone)) fingers[joint] = bone;
      else missingFingers.push(bone);
    }
    const b: { wrist: string; shoulder?: string; elbow?: string; fingers?: Partial<Record<FingerJoint, string>> } = { wrist: t.wrist };
    if (have.has(t.shoulder)) b.shoulder = t.shoulder;
    else notes.push(`任意ボーン ${t.shoulder} がありません(腕の動きは省略)`);
    if (have.has(t.elbow)) b.elbow = t.elbow;
    else notes.push(`任意ボーン ${t.elbow} がありません(腕の動きは省略)`);
    if (Object.keys(fingers).length) b.fingers = fingers;
    sides[side] = b;
  }
  if (errors.length) return { ok: false, errors };

  const capability = missingFingers.length === 0 ? 'full' : 'gesture-only';
  if (capability === 'gesture-only') notes.push(`指ボーンが ${missingFingers.length} 個不足のため gesture-only(手首/腕のみ動かす): ${missingFingers.join(', ')}`);
  const face = Object.fromEntries(Object.entries(vrmTable.bones.face).filter(([, bone]) => have.has(bone)));
  const raw = {
    schemaVersion: '0.1.0',
    id: opts.id ?? 'vrm1-humanoid.loaded',
    rig: 'vrm-humanoid',
    capability,
    bones: { left: sides.left, right: sides.right, ...(Object.keys(face).length ? { face } : {}) },
    rangeOfMotion: vrmTable.rangeOfMotion,
  };
  const v = validateAvatarProfile(raw);
  if (!v.ok) return { ok: false, errors: v.errors.map((e) => `profile 検証エラー: ${e}`) };
  return { ok: true, profile: v.value, notes, missingFingers };
}

/** ファイル名などから profile id を作る(スキーマの pattern ^[a-z0-9][a-z0-9._-]*$ に合わせる) */
export function profileIdFromName(name: string): string {
  const slug = name.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').replace(/-+$/, '');
  return `vrm1.${slug || 'avatar'}`;
}
