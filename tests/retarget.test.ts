import { describe, expect, it } from 'vitest';
import vrmJson from '../samples/vrm1-humanoid.avatar-profile.json';
import customJson from '../samples/gltf-custom.avatar-profile.json';
import gestureJson from '../samples/gesture-only.avatar-profile.json';
import { isGestureOnly, mirrorPosition, mirrorRotation, retargetMotion, retargetPose } from '../src/retarget';
import { REST_POSE } from '../src/motion/rest';
import { validateAvatarProfile } from '../src/validate';
import type { AvatarProfile, HandPose } from '../src/types/definition';
import { typedMotion } from './typed-samples';

const clone = <T>(x: T): any => JSON.parse(JSON.stringify(x));
const prof = (j: unknown): AvatarProfile => {
  const r = validateAvatarProfile(j);
  if (!r.ok) throw new Error(r.errors.join());
  return r.value;
};
const vrm = prof(vrmJson);
const custom = prof(customJson);
const gesture = prof(gestureJson);

function hand(over: { pos?: [number, number, number]; wristRot?: [number, number, number]; index?: [number, number, number] } = {}): HandPose {
  const h = clone(REST_POSE.right) as any;
  if (over.pos) h.wrist.position = over.pos;
  if (over.wristRot) h.wrist.rotation = over.wristRot;
  if (over.index) h.joints.indexMcp = over.index;
  return h;
}

describe('サンプル profile が検証を通る', () => {
  it('3種', () => {
    expect(validateAvatarProfile(vrmJson).ok).toBe(true);
    expect(validateAvatarProfile(customJson).ok).toBe(true);
    expect(validateAvatarProfile(gestureJson).ok).toBe(true);
  });
});

describe('鏡像変換', () => {
  it('位置は x のみ、回転は y・z のみ反転(-0 を作らない)', () => {
    expect(mirrorPosition([0.1, 0.2, 0.3])).toEqual([-0.1, 0.2, 0.3]);
    expect(mirrorRotation([10, 20, 30])).toEqual([10, -20, -30]);
    expect(mirrorRotation([0, 0, 0])).toEqual([0, 0, 0]);
  });
  it('左右同値の入力は、左手が鏡像になる(位置 x 反転・y/z 回転反転)', () => {
    const h = hand({ pos: [0.1, 0.2, 0.3], wristRot: [10, 20, 5] });
    const r = retargetPose({ left: h, right: h }, vrm);
    expect(r.right.wristPosition).toEqual([0.1, 0.2, 0.3]);
    expect(r.left.wristPosition).toEqual([-0.1, 0.2, 0.3]);
    expect(r.right.bones['rightHand']).toEqual([10, 20, 5]);
    expect(r.left.bones['leftHand']).toEqual([10, -20, -5]);
  });
  it('指の橈側偏位(z)も左手で反転する', () => {
    const h = hand({ index: [30, 0, 8] });
    const r = retargetPose({ left: h, right: h }, vrm);
    expect(r.right.bones['rightIndexProximal']).toEqual([30, 0, 8]);
    expect(r.left.bones['leftIndexProximal']).toEqual([30, 0, -8]);
  });
});

describe('可動域補正', () => {
  it('範囲内はそのまま・範囲外は clamp され clamped に記録される', () => {
    const inRange = retargetPose({ left: hand(), right: hand({ wristRot: [30, 0, 0] }) }, vrm);
    expect(inRange.clamped).toEqual([]);
    const out = retargetPose({ left: hand(), right: hand({ wristRot: [120, 0, -50] }) }, vrm);
    expect(out.right.bones['rightHand']).toEqual([70, 0, -30]);
    expect(out.clamped).toEqual(['right/wrist/x', 'right/wrist/z']);
  });
  it('可動域は右手基準で clamp してから鏡像(左右で同じ範囲が効く)', () => {
    const h = hand({ wristRot: [0, 0, 50] });
    const r = retargetPose({ left: h, right: h }, vrm);
    expect(r.right.bones['rightHand'][2]).toBe(30);
    expect(r.left.bones['leftHand'][2]).toBe(-30);
  });
  it('profile ごとに可動域が違う(狭い骨格のほうが強く丸まる)', () => {
    const h = hand({ index: [85, 0, 0] });
    expect(retargetPose({ left: h, right: h }, vrm).right.bones['rightIndexProximal'][0]).toBe(85);
    expect(retargetPose({ left: h, right: h }, custom).right.bones['Index1.R'][0]).toBe(70);
  });
});

describe('指ボーン不足時の gesture-only', () => {
  it('capability=gesture-only: 指の回転は出力せず手首/腕だけ', () => {
    const h = hand({ wristRot: [10, 0, 0], index: [50, 0, 0] });
    const r = retargetPose({ left: h, right: h }, gesture);
    expect(r.fallback).toBe('gesture-only');
    expect(Object.keys(r.right.bones)).toEqual(['wrist_r']);
    expect(r.right.bones['wrist_r']).toEqual([10, 0, 0]);
  });
  it('capability=full でも指ボーンが欠けていれば gesture-only に落ちる', () => {
    const p = clone(vrm);
    delete p.bones.right.fingers.indexDip;
    expect(isGestureOnly(p)).toBe(true);
    const r = retargetPose({ left: hand(), right: hand() }, p);
    expect(r.fallback).toBe('gesture-only');
    expect(Object.keys(r.right.bones)).toEqual(['rightHand']);
  });
  it('指ボーンが揃っていても capability=gesture-only の宣言を優先する', () => {
    const p = clone(vrm);
    p.capability = 'gesture-only';
    expect(isGestureOnly(p)).toBe(true);
    expect(Object.keys(retargetPose({ left: hand(), right: hand() }, p).right.bones)).toEqual(['rightHand']);
  });
  it('full の profile は none で全指ボーンが出る', () => {
    const r = retargetPose({ left: hand(), right: hand() }, vrm);
    expect(r.fallback).toBe('none');
    expect(Object.keys(r.right.bones)).toHaveLength(16);
  });
});

describe('初期姿勢補正・腕', () => {
  it('restPoseCorrection はそのボーンの回転に加算される', () => {
    const r = retargetPose({ left: hand(), right: hand({ wristRot: [10, 0, 0] }) }, custom);
    expect(r.right.bones['Hand.R']).toEqual([15, 0, 0]);
    expect(r.left.bones['Hand.L']).toEqual([5, 0, 0]);
  });
  it('arm は対応ボーンがあれば出力、無ければ捨てる', () => {
    const h = hand() as any;
    h.arm = { elbow: [200, 0, 0] };
    const full = retargetPose({ left: h, right: h }, vrm);
    expect(full.right.bones['rightLowerArm']).toEqual([145, 0, 0]);
    const noShoulder = retargetPose({ left: h, right: h }, gesture);
    expect(noShoulder.right.bones['forearm_r']).toEqual([140, 0, 0]);
    expect(noShoulder.clamped).toContain('right/elbow/x');
  });
});

describe('retargetMotion: キーフレーム列', () => {
  it('timing を引き継ぎ、指定のない手は出力しない', () => {
    const rm = retargetMotion(typedMotion, vrm);
    expect(rm.keyframes).toHaveLength(typedMotion.keyframes.length);
    expect(rm.keyframes.map((k) => k.time)).toEqual(typedMotion.keyframes.map((k) => k.time));
    expect(rm.keyframes[1].hold).toBe(0.2);
    expect(rm.profileId).toBe(vrm.id);
    expect(rm.fallback).toBe('none');
  });
  it('同じ motion を別 profile に流すとボーン名が profile のものになる', () => {
    const a = retargetMotion(typedMotion, vrm);
    const b = retargetMotion(typedMotion, custom);
    expect(Object.keys(a.keyframes[0].pose.right!.bones)).toContain('rightHand');
    expect(Object.keys(b.keyframes[0].pose.right!.bones)).toContain('Hand.R');
    expect(b.keyframes[0].pose.right!.wristPosition).toEqual(a.keyframes[0].pose.right!.wristPosition);
  });
  it('入力 motion を変更しない(純粋)', () => {
    const before = JSON.stringify(typedMotion);
    retargetMotion(typedMotion, custom);
    expect(JSON.stringify(typedMotion)).toBe(before);
  });
});
