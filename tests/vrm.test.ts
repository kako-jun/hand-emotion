import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three';

const DEG = Math.PI / 180;
import vrmTable from '../samples/vrm1-humanoid.avatar-profile.json';
import { inspectVrmGlb } from '../src/avatar/glb';
import { generateVrmProfile, profileIdFromName } from '../src/avatar/vrmProfile';
import { boneQuat, buildRestRig, handBasis, handReferenceFrame, toVrmPose, twistAbout, wristTarget } from '../src/avatar/vrmPose';
import type { Quat } from '../src/avatar/vrmPose';
import { mirrorRotation, retargetMotion, retargetPose } from '../src/retarget';
import { REST_POSE } from '../src/motion/rest';
import { validateAvatarProfile } from '../src/validate';
import { typedFullMotion, typedMotion } from './typed-samples';
import { PRESET_MOTIONS } from '../src/text/presets';
import type { HandPose, Side, Vec3 } from '../src/types/definition';
import { vrmApplyNotes } from '../src/ui/labels';
import { applyBones, buildRig, fixturePath, glbJson, readFixture, worldPos } from './vrm-fixture';

const clone = <T>(x: T): any => JSON.parse(JSON.stringify(x));
const q = (a: Quat): Quaternion => new Quaternion(a[0], a[1], a[2], a[3]);
// e は「右手規約の値」。左手には retarget と同じ鏡像(y・z 反転)をかけた値を渡す
const rot = (e: Vec3, side: Side, v: Vector3): Vector3 => v.clone().applyQuaternion(q(boneQuat(side === 'left' ? mirrorRotation(e) : e, side)));
const near = (a: Vector3, b: Vector3, eps = 1e-6): void => {
  expect(a.distanceTo(b)).toBeLessThan(eps);
};

function makeGlb(json: unknown): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(json));
  const padded = new Uint8Array(Math.ceil(body.length / 4) * 4).fill(0x20);
  padded.set(body);
  const out = new Uint8Array(20 + padded.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, out.length, true);
  v.setUint32(12, padded.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(padded, 20);
  return out;
}

describe('VRM(GLB)の検査', () => {
  it('フィクスチャは VRM 1.0: 全 humanoid 55 ボーン / 指なし版は 25', () => {
    const full = inspectVrmGlb(readFixture('stick-figure.vrm'));
    const nofing = inspectVrmGlb(readFixture('stick-figure-no-fingers.vrm'));
    expect(full.ok && full.humanBones.length).toBe(55);
    expect(nofing.ok && nofing.humanBones.length).toBe(25);
  });
  it('エラー系: GLB でない / 壊れた JSON / 普通の glTF / VRM 0.x / specVersion / humanoid 欠落', () => {
    const code = (i: ArrayBuffer | Uint8Array) => {
      const r = inspectVrmGlb(i);
      return r.ok ? 'ok' : r.code;
    };
    expect(code(new TextEncoder().encode('hello'))).toBe('not-glb');
    const bad = readFixture('stick-figure.vrm').slice();
    bad[20] = 0x7b; bad[21] = 0x7b; // JSON を壊す
    expect(code(bad)).toBe('invalid');
    expect(code(makeGlb({ asset: { version: '2.0' } }))).toBe('not-vrm');
    expect(code(makeGlb({ asset: { version: '2.0' }, extensions: { VRM: { specVersion: '0.0', humanoid: { humanBones: [] } } } }))).toBe('vrm0');
    expect(code(makeGlb({ extensions: { VRMC_vrm: { specVersion: '0.0', humanoid: { humanBones: {} } } } }))).toBe('unsupported-version');
    expect(code(makeGlb({ extensions: { VRMC_vrm: { specVersion: '1.0' } } }))).toBe('no-humanoid');
    const r = inspectVrmGlb(makeGlb({ extensions: { VRM: {} } }));
    expect(!r.ok && r.errors[0]).toContain('VRM 0.x は未対応');
    // 版が違う GLB
    const v1 = readFixture('stick-figure.vrm').slice();
    new DataView(v1.buffer).setUint32(4, 1, true);
    expect(code(v1)).toBe('not-glb');
  });
  it('フィクスチャは生成スクリプトの出力と一致(--check)', () => {
    expect(() => execFileSync('node', [fixturePath('../scripts/make-fixture-vrm.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
  });
});

describe('VRM 1.0 から avatar profile を生成', () => {
  const names = (file: string): string[] => Object.keys(glbJson(readFixture(file)).extensions.VRMC_vrm.humanoid.humanBones);
  it('全指あり -> full、既存スキーマ検証を通り、samples の対応表と一致', () => {
    const r = generateVrmProfile(names('stick-figure.vrm'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile.capability).toBe('full');
    expect(validateAvatarProfile(r.profile).ok).toBe(true);
    expect(r.profile.bones.left).toEqual(vrmTable.bones.left);
    expect(r.profile.bones.right).toEqual(vrmTable.bones.right);
    expect(r.profile.bones.face).toEqual(vrmTable.bones.face);
    expect(r.profile.rangeOfMotion).toEqual(vrmTable.rangeOfMotion);
    expect(r.profile.restPoseCorrection).toBeUndefined();
    expect(r.profile.rig).toBe('vrm-humanoid');
    expect(r.missingFingers).toEqual([]);
  });
  it('指なし -> gesture-only。手首/肩/肘は残り、指は空', () => {
    const r = generateVrmProfile(names('stick-figure-no-fingers.vrm'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile.capability).toBe('gesture-only');
    expect(r.profile.bones.left).toEqual({ wrist: 'leftHand', shoulder: 'leftUpperArm', elbow: 'leftLowerArm' });
    expect(r.missingFingers.length).toBe(30);
    expect(r.notes.join('\n')).toContain('gesture-only');
  });
  it('指が1本でも欠けたら gesture-only(部分欠損は欠けた名前を報告)', () => {
    const r = generateVrmProfile(names('stick-figure.vrm').filter((n) => n !== 'rightRingDistal'));
    expect(r.ok && r.profile.capability).toBe('gesture-only');
    expect(r.ok && r.missingFingers).toEqual(['rightRingDistal']);
  });
  it('手首が欠けたらエラー(必須)。肩/肘/顔の欠落は任意でノートのみ', () => {
    const noHand = generateVrmProfile(names('stick-figure.vrm').filter((n) => n !== 'leftHand'));
    expect(noHand.ok).toBe(false);
    expect(!noHand.ok && noHand.errors[0]).toContain('leftHand');
    const opt = generateVrmProfile(names('stick-figure.vrm').filter((n) => !['leftUpperArm', 'leftLowerArm', 'head', 'jaw'].includes(n)));
    expect(opt.ok).toBe(true);
    if (!opt.ok) return;
    expect(opt.profile.bones.left.shoulder).toBeUndefined();
    expect(opt.profile.bones.face).toBeUndefined();
    expect(opt.notes.some((n) => n.includes('leftUpperArm'))).toBe(true);
  });
  it('profile id は名前から作る(スキーマの pattern を満たす)', () => {
    expect(profileIdFromName('My Avatar.vrm')).toBe('vrm1.my-avatar');
    expect(profileIdFromName('アバター.vrm')).toBe('vrm1.avatar');
    const r = generateVrmProfile(names('stick-figure.vrm'), { id: profileIdFromName('X Y.vrm') });
    expect(r.ok && r.profile.id).toBe('vrm1.x-y');
  });
});

describe('euler -> quaternion の規約(解剖学的な定義)', () => {
  // T-pose: 右手の指 = -x、左手の指 = +x、手のひら法線 = -y(下)、母指 = +z(前)
  const finger = (s: Side): Vector3 => new Vector3(s === 'right' ? -1 : 1, 0, 0);
  const palm = new Vector3(0, -1, 0);
  const thumb = new Vector3(0, 0, 1);
  for (const side of ['right', 'left'] as const) {
    it(`${side}: 基底は右手系の回転で、指の長軸 = Y'・手のひら法線 = Z'`, () => {
      const m = handBasis(side);
      expect(m.determinant()).toBeCloseTo(1, 9);
      near(new Vector3(0, 1, 0).applyMatrix4(m), finger(side));
      near(new Vector3(0, 0, 1).applyMatrix4(m), palm);
    });
    it(`${side}: x 正 = 屈曲(指先が手のひら側へ)`, () => {
      near(rot([90, 0, 0], side, finger(side)), palm);
    });
    it(`${side}: z 正 = 橈屈(指先が母指側へ)`, () => {
      near(rot([0, 0, 90], side, finger(side)), thumb);
    });
    it(`${side}: y 正 = 回内(手のひらが母指側へ回る)`, () => {
      near(rot([0, 90, 0], side, palm), thumb);
      near(rot([0, 90, 0], side, finger(side)), finger(side)); // 長軸まわり
    });
  }
  it('左手の値 = 右手の値を鏡像にして(y・z 反転)、モデルを x で鏡像にしたものと一致', () => {
    const M = (v: Vector3): Vector3 => new Vector3(-v.x, v.y, v.z);
    for (const e of [[30, 20, 10], [-40, 70, -25], [90, -30, 15]] as Vec3[]) {
      for (const v of [new Vector3(0.3, -0.5, 0.8), new Vector3(1, 0, 0), new Vector3(0, 1, 0)]) {
        near(rot(e, 'left', v), M(rot(e, 'right', M(v))));
      }
    }
  });
  it('euler は intrinsic XYZ の順序(x の後に回転した軸で y)', () => {
    const e: Vec3 = [90, 90, 0];
    const expected = q(boneQuat([90, 0, 0], 'right')).multiply(q(boneQuat([0, 90, 0], 'right')));
    const got = q(boneQuat(e, 'right'));
    expect(got.angleTo(expected)).toBeLessThan(1e-6);
  });
  it('手の基準フレーム: 前腕が下 or 上でも手のひらは前、母指は 右手=腕の内側(上向き) or 外側(下向き)', () => {
    const palmOf = (u: Vector3, s: Side): Vector3 => new Vector3(0, 0, 1).applyMatrix4(handReferenceFrame(u, s));
    for (const s of ['right', 'left'] as const) {
      near(palmOf(new Vector3(0, -1, 0), s), new Vector3(0, 0, 1));
      near(palmOf(new Vector3(0, 1, 0), s), new Vector3(0, 0, 1));
      expect(handReferenceFrame(new Vector3(0, -1, 0), s).determinant()).toBeCloseTo(1, 9);
    }
    // 前腕が上(指が上)のとき、母指は正中線側: 右手 = +x(左)、左手 = -x(右)
    const thumbDir = (s: Side): Vector3 => new Vector3(s === 'right' ? 1 : -1, 0, 0);
    near(new Vector3(1, 0, 0).applyMatrix4(handReferenceFrame(new Vector3(0, 1, 0), 'right')), thumbDir('right'));
    near(new Vector3(-1, 0, 0).applyMatrix4(handReferenceFrame(new Vector3(0, 1, 0), 'left')), thumbDir('left'));
  });
});

describe('適用: 骨格に書いたときのワールド座標', () => {
  const rig = buildRig('stick-figure.vrm');
  const pose = (l: Partial<HandPose>, r: Partial<HandPose>) => ({ left: { ...clone(REST_POSE.left), ...l }, right: { ...clone(REST_POSE.right), ...r } });
  const run = (p: ReturnType<typeof pose>) => {
    const rp = retargetPose(p, rig.profile);
    const out = toVrmPose(rp, rig.profile, rig.rest);
    applyBones(rig, out.bones);
    return { rp, out };
  };

  it('キャラクターの left は +x、right は -x(待機姿勢の手首)', () => {
    run(pose({}, {}));
    expect(worldPos(rig.bones.leftHand).x).toBeGreaterThan(0.1);
    expect(worldPos(rig.bones.rightHand).x).toBeLessThan(-0.1);
  });
  it('手首は目標位置に届く(胸中央基準・x 反転・scale)。左右は鏡像', () => {
    const wrist = { position: [0.1, 0.2, 0.25] as Vec3, rotation: [0, 0, 0] as Vec3 };
    const { rp } = run(pose({ wrist }, { wrist }));
    for (const side of ['left', 'right'] as const) {
      near(worldPos(rig.bones[`${side}Hand`]), wristTarget(rp[side].wristPosition, rig.rest), 1e-3);
    }
    const l = worldPos(rig.bones.leftHand);
    const r = worldPos(rig.bones.rightHand);
    expect(l.x + r.x).toBeCloseTo(2 * rig.rest.chest[0], 4);
    expect(l.y).toBeCloseTo(r.y, 4);
    expect(l.z).toBeCloseTo(r.z, 4);
    // 演者の右手(+x)は VRM の right(-x)側: 胸中央より外側
    expect(r.x).toBeLessThan(rig.rest.chest[0]);
  });
  it('左右別の位置: 右手だけ高く上げると right の手首だけ上がる', () => {
    const rest = run(pose({}, {}));
    const lY = worldPos(rig.bones.leftHand).y;
    const rY = worldPos(rig.bones.rightHand).y;
    run(pose({}, { wrist: { position: [0.1, 0.3, 0.25], rotation: [0, 0, 0] } }));
    expect(worldPos(rig.bones.rightHand).y - rY).toBeGreaterThan(0.5);
    expect(worldPos(rig.bones.leftHand).y).toBeCloseTo(lY, 6);
    expect(rest.out.unreachable).toEqual([]);
  });
  it('届かない位置は腕を伸ばしきって unreachable に記録する', () => {
    const far = { position: [3, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3 };
    const { out } = run(pose({ wrist: far }, { wrist: far }));
    expect(out.unreachable).toEqual(['left', 'right']);
    expect(worldPos(rig.bones.rightHand).distanceTo(worldPos(rig.bones.rightUpperArm))).toBeLessThan(0.6 * rig.rest.scale + 0.01);
  });
  it('手のひらは前を向く(前腕が下・上のどちらでも)。母指の向きも左右で鏡像', () => {
    const palmWorld = (side: Side): Vector3 => new Vector3(0, -1, 0).applyQuaternion(rig.bones[`${side}Hand`].getWorldQuaternion(new Quaternion()));
    const thumbWorld = (side: Side): Vector3 => new Vector3(side === 'right' ? 1 : -1, 0, 0).applyQuaternion(rig.bones[`${side}Hand`].getWorldQuaternion(new Quaternion()));
    // 待機(前腕が下): 手のひらは前(+z)、母指は外向き(右手 = -x、左手 = +x)
    run(pose({}, {}));
    for (const s of ['left', 'right'] as const) expect(palmWorld(s).z).toBeGreaterThan(0.6);
    // ここで右手の基底 X'(thumb を表す列)と左右の向きの対応を確かめる: 右手の母指軸は +z → 手のひらと直交
    expect(Math.abs(palmWorld('right').dot(thumbWorld('right')))).toBeLessThan(1e-6);
    // 前腕が上(指が上): 手のひらは前、母指は正中線側
    const up = { position: [0.08, 0.35, 0.22] as Vec3, rotation: [0, 0, 0] as Vec3 };
    run(pose({ wrist: up }, { wrist: up }));
    for (const s of ['left', 'right'] as const) expect(palmWorld(s).z).toBeGreaterThan(0.5);
  });
  it('手首 y(回内)で手のひらが向きを変え、左右で鏡像になる', () => {
    const base = { position: [0.08, 0.35, 0.22] as Vec3 };
    const wr = (r: Vec3) => ({ ...base, rotation: r });
    run(pose({ wrist: wr([0, 90, 0]) }, { wrist: wr([0, 90, 0]) }));
    const pal = (s: Side) => new Vector3(0, -1, 0).applyQuaternion(rig.bones[`${s}Hand`].getWorldQuaternion(new Quaternion()));
    // 左右は x だけ反転した向き
    expect(pal('left').x).toBeCloseTo(-pal('right').x, 4);
    expect(pal('left').y).toBeCloseTo(pal('right').y, 4);
    expect(pal('left').z).toBeCloseTo(pal('right').z, 4);
    expect(Math.abs(pal('right').x)).toBeGreaterThan(0.5); // 前向きから横へ回っている
  });
  it('指の屈曲: 示指 MCP の x 正で指先が手のひら側へ曲がる(全指ありの版のみ)', () => {
    const hand = (x: number): Partial<HandPose> => ({ joints: { ...clone(REST_POSE.right.joints), indexMcp: [x, 0, 0] } });
    const palmDir = (s: Side) => new Vector3(0, -1, 0).applyQuaternion(rig.bones[`${s}Hand`].getWorldQuaternion(new Quaternion()));
    const tip = (s: Side) => worldPos(rig.bones[`${s}IndexDistal`]).sub(worldPos(rig.bones[`${s}IndexProximal`]));
    run(pose(hand(0), hand(0)));
    const straight = { l: tip('left').dot(palmDir('left')), r: tip('right').dot(palmDir('right')) };
    run(pose(hand(80), hand(80)));
    expect(tip('right').dot(palmDir('right')) - straight.r).toBeGreaterThan(0.02);
    expect(tip('left').dot(palmDir('left')) - straight.l).toBeGreaterThan(0.02);
  });
  it('可動域超過は retarget で丸められ、適用層には丸め後の値が届く', () => {
    const wrist = { position: [0.1, 0.2, 0.25] as Vec3, rotation: [200, 0, 0] as Vec3 };
    const { rp } = run(pose({ wrist }, { wrist }));
    expect(rp.clamped.some((c) => c.includes('wrist/x'))).toBe(true);
    const clampedQ = q(toVrmPose(retargetPose(pose({ wrist: { ...wrist, rotation: [70, 0, 0] } }, { wrist: { ...wrist, rotation: [70, 0, 0] } }), rig.profile, ), rig.profile, rig.rest).bones.rightHand);
    const gotQ = q(toVrmPose(rp, rig.profile, rig.rest).bones.rightHand);
    expect(gotQ.angleTo(clampedQ)).toBeLessThan(1e-6);
  });
  it('プリセット motion を全キーフレーム流しても、手首が目標へ届く(NaN なし・反転なし)', () => {
    for (const m of [...PRESET_MOTIONS, typedMotion]) {
      const rm = retargetMotion(m as any, rig.profile);
      for (const k of rm.keyframes) {
        const rp = { left: k.pose.left ?? retargetPose(REST_POSE, rig.profile).left, right: k.pose.right ?? retargetPose(REST_POSE, rig.profile).right, fallback: rm.fallback, clamped: [] };
        const out = toVrmPose(rp, rig.profile, rig.rest);
        applyBones(rig, out.bones);
        for (const s of ['left', 'right'] as const) {
          const w = worldPos(rig.bones[`${s}Hand`]);
          expect(Number.isFinite(w.x + w.y + w.z)).toBe(true);
          if (!out.unreachable.includes(s)) near(w, wristTarget(rp[s].wristPosition, rig.rest), 2e-3);
        }
      }
    }
  });
});

describe('指ボーン欠落版(gesture-only)', () => {
  const rig = buildRig('stick-figure-no-fingers.vrm');
  it('profile は gesture-only で、指の回転は出力されない。手首/腕は動く', () => {
    expect(rig.profile.capability).toBe('gesture-only');
    const rp = retargetPose(REST_POSE, rig.profile);
    expect(rp.fallback).toBe('gesture-only');
    const out = toVrmPose(rp, rig.profile, rig.rest);
    expect(Object.keys(out.bones).sort()).toEqual(['leftHand', 'leftLowerArm', 'leftUpperArm', 'rightHand', 'rightLowerArm', 'rightUpperArm']);
    applyBones(rig, out.bones);
    expect(worldPos(rig.bones.leftHand).x).toBeGreaterThan(0.1);
  });
});

const hp = (position: Vec3, rotation: Vec3 = [0, 0, 0]): HandPose => ({ ...clone(REST_POSE.right), wrist: { position, rotation } });

describe('位置・肘・手の向きを絶対値で検証(実装の定数と循環しない)', () => {
  const rig = buildRig('stick-figure.vrm');
  const place = (l: HandPose, r: HandPose) => {
    const out = toVrmPose(retargetPose({ left: l, right: r }, rig.profile), rig.profile, rig.rest);
    applyBones(rig, out.bones);
    return out;
  };
  it('位置の符号: 演者の前方(+z)・上(+y)・右(+x)が VRM の前方・上・right(-x)側に出る', () => {
    place(hp([0.1, 0.2, 0.25]), hp([0.1, 0.2, 0.25]));
    const c = rig.rest.chest;
    const s = rig.rest.scale;
    const r = worldPos(rig.bones.rightHand);
    expect(r.z - c[2]).toBeCloseTo(0.25 * s, 3);
    expect(r.y - c[1]).toBeCloseTo(0.2 * s, 3);
    expect(c[0] - r.x).toBeCloseTo(0.1 * s, 3); // 演者の右 = VRM の -x
    const l = worldPos(rig.bones.leftHand);
    expect(l.x - c[0]).toBeCloseTo(0.1 * s, 3); // 左は retarget の鏡像で +x 側
  });
  it('肘は肩-手首の線より 下・外・後ろ に曲がる', () => {
    const off = (side: Side): Vector3 => {
      const sh = worldPos(rig.bones[`${side}UpperArm`]);
      const el = worldPos(rig.bones[`${side}LowerArm`]);
      const wr = worldPos(rig.bones[`${side}Hand`]);
      const dir = wr.clone().sub(sh).normalize();
      const v = el.clone().sub(sh);
      return v.addScaledVector(dir, -v.dot(dir));
    };
    place(hp([0.1, 0.2, 0.3]), hp([0.1, 0.2, 0.3]));
    expect(off('right').y).toBeLessThan(-0.01);
    expect(off('left').y).toBeLessThan(-0.01);
    expect(off('right').x).toBeLessThan(0); // 外 = right は -x、left は +x
    expect(off('left').x).toBeGreaterThan(0);
    // 手首が肩の真上: 曲がる向きは 外・後ろ(下は直交成分に出ない)
    const up = [0.2, 0.45, 0.0] as Vec3;
    place(hp(up), hp(up));
    expect(off('right').z).toBeLessThan(-0.01);
    expect(off('left').z).toBeLessThan(-0.01);
  });
  it('手の基準フレーム: 手のひら法線は「前・下寄り 45° の基準」を前腕に直交化したもの', () => {
    const ref = new Vector3(0, -1, 1).normalize();
    for (const u of [new Vector3(0, -0.5, 0.87), new Vector3(0, 0.5, 0.87), new Vector3(0, 0, 1), new Vector3(-1, 0, 0), new Vector3(0, -1, 0)]) {
      u.normalize();
      const expected = ref.clone().addScaledVector(u, -ref.dot(u)).normalize();
      for (const side of ['right', 'left'] as const) {
        near(new Vector3(0, 0, 1).applyMatrix4(handReferenceFrame(u, side)), expected, 1e-9);
      }
    }
    // 前腕が前を向くとき手のひらは下、前下・前上でも下寄り(上向きにならない)
    for (const u of [new Vector3(0, 0, 1), new Vector3(0, -0.5, 0.87), new Vector3(0, 0.5, 0.87)]) {
      expect(new Vector3(0, 0, 1).applyMatrix4(handReferenceFrame(u.normalize(), 'right')).y).toBeLessThan(0);
    }
  });
  it('特異点(前腕 = 基準ベクトルと平行)でも基底は直交・単位長・det 1、quaternion は単位長', () => {
    for (const u of [new Vector3(0, -1, 1).normalize(), new Vector3(0, 1, -1).normalize()]) {
      for (const side of ['right', 'left'] as const) {
        const m = handReferenceFrame(u, side);
        expect(m.determinant()).toBeCloseTo(1, 9);
        const cols = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map((e) => e.applyMatrix4(m));
        cols.forEach((c) => expect(c.length()).toBeCloseTo(1, 9));
        expect(cols[0].dot(cols[1])).toBeCloseTo(0, 9);
        expect(cols[1].dot(cols[2])).toBeCloseTo(0, 9);
        near(cols[1], u, 1e-9);
      }
    }
  });
  it('手の world 向き = 基準フレーム × euler × B⁻¹(前腕のひねり分割後も不変)', () => {
    for (const e of [[0, 0, 0], [20, 40, 10], [-30, 70, -10]] as Vec3[]) {
      for (const pos of [[0.2, -0.4, 0.05], [0.1, 0.2, 0.3], [0.08, 0.35, 0.22]] as Vec3[]) {
        place(hp(pos, e), hp(pos, e));
        const rp = retargetPose({ left: hp(pos, e), right: hp(pos, e) }, rig.profile);
        for (const side of ['right', 'left'] as const) {
          const forearm = worldPos(rig.bones[`${side}Hand`]).sub(worldPos(rig.bones[`${side}LowerArm`])).normalize();
          const eul = rp[side].bones[`${side}Hand`];
          const E = new Quaternion().setFromEuler(new Euler(eul[0] * DEG, eul[1] * DEG, -eul[2] * DEG, 'XYZ'));
          const expected = new Quaternion().setFromRotationMatrix(handReferenceFrame(forearm, side)).multiply(E).multiply(new Quaternion().setFromRotationMatrix(handBasis(side)).invert());
          const got = rig.bones[`${side}Hand`].getWorldQuaternion(new Quaternion());
          expect(got.angleTo(expected)).toBeLessThan(1e-6);
        }
      }
    }
  });
  it('前腕のひねりは lowerArm が持ち、hand には swing だけが入る(待機姿勢で hand に大きなひねりが残らない)', () => {
    const axisOf = (side: Side): Vector3 => worldPos(rig.bones[`${side}Hand`]).sub(worldPos(rig.bones[`${side}LowerArm`])).normalize();
    for (const [pos, e] of [[[0.2, -0.4, 0.05], [0, 0, 0]], [[0.1, 0.2, 0.3], [0, 60, 0]]] as [Vec3, Vec3][]) {
      const out = place(hp(pos, e), hp(pos, e));
      for (const side of ['right', 'left'] as const) {
        const hand = q(out.bones[`${side}Hand`]);
        const axis = new Vector3(side === 'left' ? 1 : -1, 0, 0); // fixture の lowerArm 長軸(rest)
        const tw = twistAbout(hand, axis);
        expect(2 * Math.acos(Math.min(1, Math.abs(tw.w)))).toBeLessThan(1e-6);
        void axisOf;
      }
    }
    // ひねりが実際に lowerArm 側にある: 待機姿勢の lowerArm ローカル回転は前腕軸まわりに十分回っている
    const rest = place(hp([0.2, -0.4, 0.05]), hp([0.2, -0.4, 0.05]));
    const lowerTwist = twistAbout(q(rest.bones.rightLowerArm), new Vector3(-1, 0, 0));
    expect(2 * Math.acos(Math.min(1, Math.abs(lowerTwist.w)))).toBeGreaterThan(0.3);
  });
  it('twistAbout: 軸まわりの回転はそのまま取り出し、軸に直交する回転は twist 0', () => {
    const a = new Vector3(1, 0, 0);
    const pure = new Quaternion().setFromAxisAngle(a, 1.0);
    expect(twistAbout(pure, a).angleTo(pure)).toBeLessThan(1e-9);
    const swing = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.0);
    expect(twistAbout(swing, a).angleTo(new Quaternion())).toBeLessThan(1e-9);
    expect(twistAbout(new Quaternion(1, 0, 0, 0).setFromAxisAngle(new Vector3(0, 1, 0), Math.PI), a).length()).toBeCloseTo(1, 9);
  });
  it('arm.shoulder / elbow が明示されても手首は目標に一致する(IK 優先・適用しない側を記録)', () => {
    const withArm = (pos: Vec3, shoulder: Vec3, elbow: Vec3): HandPose => ({ ...hp(pos), arm: { shoulder, elbow } });
    const cases: [Vec3, Vec3, Vec3][] = [[[0.1, 0.1, 0.3], [0, 0, 0], [30, 0, 0]], [[0.1, 0.1, 0.3], [10, 0, 0], [90, 0, 0]], [[0.05, 0.2, 0.2], [-20, 30, 10], [120, 0, 0]]];
    for (const [pos, sh, el] of cases) {
      const rp = retargetPose({ left: withArm(pos, sh, el), right: withArm(pos, sh, el) }, rig.profile);
      const out = toVrmPose(rp, rig.profile, rig.rest);
      applyBones(rig, out.bones);
      expect(out.armOverridden).toEqual(['left', 'right']);
      for (const side of ['left', 'right'] as const) near(worldPos(rig.bones[`${side}Hand`]), wristTarget(rp[side].wristPosition, rig.rest), 2e-3);
    }
    // typedFullMotion(arm 値入り)の全キーフレームでも一致
    const rm = retargetMotion(typedFullMotion as any, rig.profile);
    for (const k of rm.keyframes) {
      const base = retargetPose(REST_POSE, rig.profile);
      const rp = { left: k.pose.left ?? base.left, right: k.pose.right ?? base.right, fallback: rm.fallback, clamped: [] };
      const out = toVrmPose(rp, rig.profile, rig.rest);
      applyBones(rig, out.bones);
      for (const side of ['left', 'right'] as const) if (!out.unreachable.includes(side)) near(worldPos(rig.bones[`${side}Hand`]), wristTarget(rp[side].wristPosition, rig.rest), 2e-3);
    }
    // arm なしの motion では記録されない
    const plain = toVrmPose(retargetPose({ left: hp([0.1, 0.1, 0.3]), right: hp([0.1, 0.1, 0.3]) }, rig.profile), rig.profile, rig.rest);
    expect(plain.armOverridden).toEqual([]);
  });
});

describe('IK の堅牢性とエッジ', () => {
  const rig = buildRig('stick-figure.vrm');
  it('長さ 0 の上腕/前腕は IK しない(arms[side] = null)。NaN を出さない', () => {
    const pos: Record<string, Vec3> = {};
    for (const [n, o] of Object.entries(rig.bones)) {
      const p = worldPos(o);
      pos[n] = [p.x, p.y, p.z];
    }
    pos.leftLowerArm = pos.leftUpperArm; // 上腕の長さ 0
    pos.rightHand = pos.rightLowerArm; // 前腕の長さ 0
    const r = buildRestRig(pos, rig.profile);
    expect(r.arms.left).toBeNull();
    expect(r.arms.right).toBeNull();
    const out = toVrmPose(retargetPose({ left: hp([0.1, 0.2, 0.3]), right: hp([0.1, 0.2, 0.3]) }, rig.profile), rig.profile, r);
    for (const v of Object.values(out.bones)) for (const c of v) expect(Number.isFinite(c)).toBe(true);
    expect(Object.keys(out.bones).filter((n) => /Arm$/.test(n))).toEqual([]); // 腕ボーンは書かない
  });
  it('全 quaternion が単位長(基準ベクトルと平行な前腕を含む)', () => {
    for (const pos of [[0.1, 0.2, 0.3], [0.2, -0.4, 0.05], [0.3, 0.0, 0.3]] as Vec3[]) {
      const out = toVrmPose(retargetPose({ left: hp(pos), right: hp(pos) }, rig.profile), rig.profile, rig.rest);
      for (const v of Object.values(out.bones)) expect(q(v).length()).toBeCloseTo(1, 9);
    }
  });
});

describe('GLB 検査の追加(ノード番号・specVersion)', () => {
  const base = (humanBones: unknown, specVersion: unknown = '1.0') => makeGlb({ nodes: [{}, {}, {}], extensions: { VRMC_vrm: { specVersion, humanoid: { humanBones } } } });
  it('ノード番号が範囲外・負数・小数・文字列なら行つきエラー', () => {
    for (const bad of [3, -1, 1.5, '1', null, Number.NaN]) {
      const r = inspectVrmGlb(base({ hips: { node: 0 }, leftHand: { node: bad } }));
      expect(r.ok).toBe(false);
      expect(!r.ok && r.code).toBe('invalid');
      expect(!r.ok && r.errors[0]).toContain('humanBones.leftHand.node');
    }
    const ok = inspectVrmGlb(base({ hips: { node: 0 }, leftHand: { node: 2 } }));
    expect(ok.ok && ok.humanBones).toEqual(['hips', 'leftHand']);
    // nodes 配列がない
    const noNodes = inspectVrmGlb(makeGlb({ extensions: { VRMC_vrm: { specVersion: '1.0', humanoid: { humanBones: { hips: { node: 0 } } } } } }));
    expect(noNodes.ok).toBe(false);
  });
  it('specVersion は three-vrm が受け付ける "1.0" / "1.0-beta" だけ', () => {
    expect(inspectVrmGlb(base({ hips: { node: 0 } }, '1.0')).ok).toBe(true);
    expect(inspectVrmGlb(base({ hips: { node: 0 } }, '1.0-beta')).ok).toBe(true);
    for (const v of ['1.1', '1.', '1.0.0', '2.0', 1, null]) {
      const r = inspectVrmGlb(base({ hips: { node: 0 } }, v));
      expect(!r.ok && r.code).toBe('unsupported-version');
    }
  });
});

describe('表示用の注意文と特異点への距離', () => {
  it('vrmApplyNotes: 未適用の arm と届かない手を左右つきで出し、なければ空', () => {
    expect(vrmApplyNotes({ unreachable: [], armOverridden: [] })).toBe('');
    expect(vrmApplyNotes({ unreachable: [], armOverridden: ['left', 'right'] })).toBe('肩/肘の指定は IK 優先で未適用(左・右)');
    expect(vrmApplyNotes({ unreachable: ['right'], armOverridden: ['left'] })).toBe('肩/肘の指定は IK 優先で未適用(左) / 手首が届かず腕を伸ばしきり(右)');
  });
  it('同梱モーションの前腕は基準ベクトルの軸(前下45°/後ろ上45°)から 10° 以上離れている', () => {
    const rig = buildRig('stick-figure.vrm');
    const axis = new Vector3(0, -1, 1).normalize();
    let minAngle = 90;
    for (const m of [...PRESET_MOTIONS, typedMotion]) {
      const rm = retargetMotion(m as any, rig.profile);
      for (const k of rm.keyframes) {
        const base = retargetPose(REST_POSE, rig.profile);
        const rp = { left: k.pose.left ?? base.left, right: k.pose.right ?? base.right, fallback: rm.fallback, clamped: [] };
        applyBones(rig, toVrmPose(rp, rig.profile, rig.rest).bones);
        for (const s of ['left', 'right'] as const) {
          const u = worldPos(rig.bones[`${s}Hand`]).sub(worldPos(rig.bones[`${s}LowerArm`])).normalize();
          const a = Math.acos(Math.min(1, Math.abs(u.dot(axis)))) / DEG;
          minAngle = Math.min(minAngle, a);
        }
      }
    }
    expect(minAngle).toBeGreaterThan(10);
  });
});
