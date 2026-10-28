// 描画だけ: retarget の結果(ボーン名 -> 回転)を簡易手モデルへ適用する。マッピングの判断はしない。
import * as THREE from 'three';
import type { RetargetedPose, BoneHandPose } from '../retarget';
import type { AvatarProfile, FingerJoint, Side } from '../types/definition';

const DEG = Math.PI / 180;

export type RigStyle = Readonly<{ colors: Readonly<Record<Side, number>>; fingerScale: number; palmScale: number }>;

type Joint = { obj: THREE.Object3D; rest: THREE.Quaternion; bone: string | undefined };

class HandRig {
  readonly root = new THREE.Group();
  private readonly wrist = new THREE.Group();
  private readonly wristBone: string;
  private readonly joints: Joint[] = [];
  private readonly wristJoint: Joint;

  constructor(side: Side, profile: AvatarProfile, style: RigStyle) {
    const sx = side === 'right' ? 1 : -1; // 右手規約のモデルを左手では x 反転(母指側が逆になる)
    const mat = new THREE.MeshStandardMaterial({ color: style.colors[side] });
    this.wristBone = profile.bones[side].wrist;
    this.root.add(this.wrist);
    const ps = style.palmScale;
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.08 * ps, 0.09 * ps, 0.02 * ps), mat);
    palm.position.y = 0.045 * ps;
    this.wrist.add(palm);
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.2), mat);
    forearm.position.y = -0.1;
    this.wrist.add(forearm);
    this.wristJoint = { obj: this.wrist, rest: new THREE.Quaternion(), bone: this.wristBone };

    const fingers = profile.bones[side].fingers ?? {};
    const chain = (names: readonly [FingerJoint, FingerJoint, FingerJoint], baseX: number, baseY: number, lens: readonly [number, number, number], restZ: number): void => {
      let parent: THREE.Object3D = this.wrist;
      names.forEach((n, i) => {
        const g = new THREE.Group();
        const len = lens[i] * style.fingerScale;
        if (i === 0) g.position.set(baseX * sx, baseY, 0);
        else g.position.y = lens[i - 1] * style.fingerScale;
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.009, len), mat);
        seg.position.y = len / 2;
        g.add(seg);
        const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, i === 0 ? restZ * sx * DEG : 0));
        g.quaternion.copy(rest);
        parent.add(g);
        this.joints.push({ obj: g, rest, bone: fingers[n] });
        parent = g;
      });
    };
    const top = 0.09 * ps;
    // 右手: 母指は -x 側(橈側)。z 正の回転で指先が -x へ倒れる規約と一致させる
    chain(['thumbCmc', 'thumbMcp', 'thumbIp'], -0.04 * ps, 0.02 * ps, [0.035, 0.03, 0.025], 25);
    chain(['indexMcp', 'indexPip', 'indexDip'], -0.027 * ps, top, [0.04, 0.025, 0.02], 0);
    chain(['middleMcp', 'middlePip', 'middleDip'], -0.009 * ps, top, [0.045, 0.028, 0.02], 0);
    chain(['ringMcp', 'ringPip', 'ringDip'], 0.009 * ps, top, [0.04, 0.025, 0.02], 0);
    chain(['littleMcp', 'littlePip', 'littleDip'], 0.027 * ps, top, [0.032, 0.02, 0.018], 0);
  }

  apply(p: BoneHandPose): void {
    this.root.position.set(p.wristPosition[0], p.wristPosition[1], p.wristPosition[2]);
    for (const j of [this.wristJoint, ...this.joints]) {
      const r = (j.bone && p.bones[j.bone]) || [0, 0, 0];
      j.obj.quaternion.setFromEuler(new THREE.Euler(r[0] * DEG, r[1] * DEG, r[2] * DEG, 'XYZ')).multiply(j.rest);
    }
  }
}

/** 1つの骨格(profile)に対応する両手モデル。 */
export class HandRigPair {
  readonly group = new THREE.Group();
  private readonly hands: Record<Side, HandRig>;

  constructor(readonly profile: AvatarProfile, style: RigStyle) {
    this.hands = { left: new HandRig('left', profile, style), right: new HandRig('right', profile, style) };
    this.group.add(this.hands.left.root, this.hands.right.root);
  }

  apply(pose: RetargetedPose): void {
    this.hands.left.apply(pose.left);
    this.hands.right.apply(pose.right);
  }

  /** 検証用: 手首のワールド位置と、指定ボーンの回転(度) */
  snapshot(side: Side): { wrist: [number, number, number] } {
    const v = new THREE.Vector3();
    this.hands[side].root.getWorldPosition(v);
    return { wrist: [v.x, v.y, v.z] };
  }
}
