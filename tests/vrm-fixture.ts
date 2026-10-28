// テスト用: フィクスチャ VRM(GLB)から Object3D 階層を組む(raw ボーン = T-pose・回転単位)。Three.js のシーン/DOM は使わない。
import { readFileSync } from 'node:fs';
import { Object3D, Vector3 } from 'three';
import { generateVrmProfile } from '../src/avatar/vrmProfile';
import { buildRestRig } from '../src/avatar/vrmPose';
import type { RestRig } from '../src/avatar/vrmPose';
import type { AvatarProfile, Vec3 } from '../src/types/definition';

export const fixturePath = (name: string): string => new URL(`../fixtures/${name}`, import.meta.url).pathname;
export const readFixture = (name: string): Uint8Array => new Uint8Array(readFileSync(fixturePath(name)));

export function glbJson(bytes: Uint8Array): any {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true))));
}

export type Rig = { bones: Record<string, Object3D>; root: Object3D; profile: AvatarProfile; rest: RestRig };

export function buildRig(file: string): Rig {
  const json = glbJson(readFixture(file));
  const objs: Object3D[] = json.nodes.map((n: any) => {
    const o = new Object3D();
    o.name = n.name;
    if (n.translation) o.position.set(...(n.translation as [number, number, number]));
    return o;
  });
  json.nodes.forEach((n: any, i: number) => (n.children ?? []).forEach((c: number) => objs[i].add(objs[c])));
  const root = objs[json.scenes[0].nodes[0]];
  root.updateMatrixWorld(true);
  const bones: Record<string, Object3D> = {};
  for (const [name, v] of Object.entries<any>(json.extensions.VRMC_vrm.humanoid.humanBones)) bones[name] = objs[v.node];
  const r = generateVrmProfile(Object.keys(bones));
  if (!r.ok) throw new Error(r.errors.join());
  const positions: Record<string, Vec3> = {};
  for (const [name, o] of Object.entries(bones)) {
    const p = o.getWorldPosition(new Vector3());
    positions[name] = [p.x, p.y, p.z];
  }
  return { bones, root, profile: r.profile, rest: buildRestRig(positions, r.profile) };
}

/** 骨格にローカル quaternion を書いてワールド行列を更新する */
export function applyBones(rig: Rig, q: Readonly<Record<string, readonly [number, number, number, number]>>): void {
  for (const [name, o] of Object.entries(rig.bones)) o.quaternion.set(0, 0, 0, 1);
  for (const [name, v] of Object.entries(q)) rig.bones[name].quaternion.set(v[0], v[1], v[2], v[3]);
  rig.root.updateMatrixWorld(true);
}
export const worldPos = (o: Object3D): Vector3 => o.getWorldPosition(new Vector3());
