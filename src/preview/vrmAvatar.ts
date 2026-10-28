// 描画/適用だけ: .vrm を読み、toVrmPose の結果を normalized humanoid ボーンへ書く。座標・規約の判断はしない(src/avatar/)。
// 読み込みはブラウザ内だけ(ファイルは fetch しない・アップロードしない)。VRM 1.0 のみ対応。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import type { VRM } from '@pixiv/three-vrm';
import { inspectVrmGlb } from '../avatar/glb';
import { buildRestRig, handBasis, toVrmPose } from '../avatar/vrmPose';
import type { RestRig } from '../avatar/vrmPose';
import { generateVrmProfile, profileIdFromName } from '../avatar/vrmProfile';
import type { RetargetedPose } from '../retarget';
import type { AvatarProfile, Side, Vec3 } from '../types/definition';

export type VrmLoadResult = Readonly<{ ok: true; avatar: VrmAvatar }> | Readonly<{ ok: false; errors: readonly string[] }>;

/** 検証用: 手首のワールド位置と、手の軸(指・手のひら法線・母指)のワールド向き */
export type HandSnapshot = Readonly<{ wrist: Vec3; finger: Vec3; palm: Vec3; thumb: Vec3 }>;

export class VrmAvatar {
  constructor(
    private readonly vrm: VRM,
    readonly profile: AvatarProfile,
    readonly rest: RestRig,
    readonly name: string,
    readonly notes: readonly string[],
  ) {}

  get scene(): THREE.Object3D {
    return this.vrm.scene;
  }

  /** 全ボーンを T-pose に戻してから retarget の結果を書く */
  apply(pose: RetargetedPose, dt: number): readonly string[] {
    const out = toVrmPose(pose, this.profile, this.rest);
    for (const side of ['left', 'right'] as const) {
      const b = this.profile.bones[side];
      for (const name of [b.wrist, b.shoulder, b.elbow, ...Object.values(b.fingers ?? {})]) {
        if (name) this.vrm.humanoid.getNormalizedBoneNode(name as never)?.quaternion.set(0, 0, 0, 1);
      }
    }
    for (const [name, q] of Object.entries(out.bones)) this.vrm.humanoid.getNormalizedBoneNode(name as never)?.quaternion.set(q[0], q[1], q[2], q[3]);
    this.vrm.update(dt);
    return out.unreachable;
  }

  snapshot(side: Side): HandSnapshot {
    const node = this.vrm.humanoid.getRawBoneNode(this.profile.bones[side].wrist as never);
    if (!node) throw new Error('hand bone missing');
    node.updateWorldMatrix(true, false);
    const q = node.getWorldQuaternion(new THREE.Quaternion());
    const b = handBasis(side);
    const dir = (x: number, y: number, z: number): Vec3 => {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(b).applyQuaternion(q);
      return [v.x, v.y, v.z];
    };
    const p = node.getWorldPosition(new THREE.Vector3());
    const x = dir(1, 0, 0);
    // X' は右手では母指向き、左手では母指の逆向き(基底は左右で鏡像)
    return { wrist: [p.x, p.y, p.z], finger: dir(0, 1, 0), palm: dir(0, 0, 1), thumb: side === 'right' ? x : [-x[0], -x[1], -x[2]] };
  }

  dispose(): void {
    this.vrm.scene.removeFromParent();
    VRMUtils.deepDispose(this.vrm.scene);
  }
}

/** .vrm のバイト列から読み込む。失敗は例外にせず、行ごとのエラー文を返す */
export async function loadVrm(bytes: ArrayBuffer, fileName: string): Promise<VrmLoadResult> {
  const info = inspectVrmGlb(bytes);
  if (!info.ok) return { ok: false, errors: info.errors };
  const gen = generateVrmProfile(info.humanBones, { id: profileIdFromName(fileName) });
  if (!gen.ok) return { ok: false, errors: gen.errors };
  let vrm: VRM | undefined;
  try {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.parseAsync(bytes, '');
    vrm = gltf.userData.vrm as VRM | undefined;
  } catch (e) {
    return { ok: false, errors: [`VRM の読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`] };
  }
  if (!vrm) return { ok: false, errors: ['VRM として読み込めませんでした(three-vrm が VRM と認識しなかった)'] };
  vrm.scene.updateMatrixWorld(true);
  const positions: Record<string, Vec3> = {};
  for (const side of ['left', 'right'] as const) {
    const b = gen.profile.bones[side];
    for (const name of [b.wrist, b.shoulder, b.elbow]) {
      const node = name ? vrm.humanoid.getNormalizedBoneNode(name as never) : null;
      if (name && node) {
        const p = node.getWorldPosition(new THREE.Vector3());
        positions[name] = [p.x, p.y, p.z];
      }
    }
  }
  return { ok: true, avatar: new VrmAvatar(vrm, gen.profile, buildRestRig(positions, gen.profile), info.name ?? fileName, gen.notes) };
}
