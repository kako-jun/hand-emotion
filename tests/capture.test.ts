import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { classifyCameraError, classifyModelError } from '../src/capture/errors';
import { estimateForearm, handReferenceFrame, handToPose, resolveSide } from '../src/capture/hand';
import { matToEuler, eulerToMat, mul, transpose, wrap180 } from '../src/capture/math';
import type { V3 } from '../src/capture/math';
import { RECORDED_SOURCE, buildRecordedMotion, rangeWarnings } from '../src/capture/motion';
import { DEFAULT_OUTLIER, channelsToPose, decimate, fillGaps, poseToChannels, removeOutliers, smooth, unwrapRotation, wrapRotation } from '../src/capture/series';
import type { Sample } from '../src/capture/series';
import { DEFAULT_SETTINGS } from '../src/capture/types';
import type { CaptureFrame, CaptureSettings, DetectedHand } from '../src/capture/types';
import { MIN_PLANE_RATIO } from '../src/capture/hand';
import { handReferenceFrame as vrmReferenceFrame, toVrmPose } from '../src/avatar/vrmPose';
import { samplePose } from '../src/motion/interpolate';
import { REST_POSE } from '../src/motion/rest';
import { retargetPose } from '../src/retarget';
import { DEFAULT_VOCABULARY, addMotionToVocabulary, textToSequence } from '../src/text/vocabulary';
import { planFromText } from '../src/modes';
import { FINGER_JOINTS } from '../src/types/definition';
import type { AvatarProfile, FingerJoint, HandPose, Side, Vec3 } from '../src/types/definition';
import { validateAvatarProfile, validateMotion } from '../src/validate';
import vrmProfileJson from '../samples/vrm1-humanoid.avatar-profile.json';
import { applyBones, buildRig } from './vrm-fixture';
import { synthesizeHand } from './capture-synth';
import { CAPTURE_ERROR_LABELS, REC_MODEL_NOTE, REC_NOTICE, REC_STATUS, REC_TITLE, REC_VOCAB_NOTE, UNREVIEWED_BADGE, captureWarningLine, detectionLabel } from '../src/ui/labels';

const profile = (() => {
  const r = validateAvatarProfile(vrmProfileJson);
  if (!r.ok) throw new Error(r.errors.join());
  return r.value as AvatarProfile;
})();

const flat = (): Record<FingerJoint, Vec3> => Object.fromEntries(FINGER_JOINTS.map((j) => [j, [0, 0, 0]])) as unknown as Record<FingerJoint, Vec3>;
const mk = (position: Vec3, rotation: Vec3, flex: Partial<Record<FingerJoint, number>> = {}): HandPose => {
  const joints = flat();
  for (const [j, v] of Object.entries(flex)) joints[j as FingerJoint] = [v, 0, 0];
  return { wrist: { position, rotation }, joints };
};
/** 2 つの euler(motion の規約: z は橈屈で符号反転)が表す向きの差(度) */
const rotAngle = (a: Vec3, b: Vec3): number => {
  const m = (e: Vec3): ReturnType<typeof eulerToMat> => eulerToMat([e[0], e[1], -e[2]]);
  const r = mul(transpose(m(a)), m(b));
  const tr = r[0][0] + r[1][1] + r[2][2];
  return (Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2))) * 180) / Math.PI;
};
const angDiff = (a: number, b: number): number => Math.abs(wrap180(a - b));

function expectPoseClose(got: HandPose, want: HandPose, posEps = 1e-6, angEps = 1e-4): void {
  got.wrist.position.forEach((v, i) => expect(Math.abs(v - want.wrist.position[i]), `pos[${i}]`).toBeLessThan(posEps));
  got.wrist.rotation.forEach((v, i) => expect(angDiff(v, want.wrist.rotation[i]), `rot[${i}]`).toBeLessThan(angEps));
  for (const j of FINGER_JOINTS) {
    expect(angDiff(got.joints[j][0], want.joints[j][0]), j).toBeLessThan(angEps);
    expect(got.joints[j][1]).toBe(0);
    expect(got.joints[j][2]).toBe(0);
  }
}

const POSES: [string, HandPose][] = [
  ['基準', mk([0.1, 0.1, 0.25], [0, 0, 0])],
  ['傾けて曲げる', mk([0.25, 0.2, 0.3], [20, -15, 10], { indexMcp: 40, indexPip: 55, indexDip: 20, middleMcp: 70, middlePip: 80, middleDip: 50, thumbCmc: 25, thumbMcp: 15, thumbIp: 10, littleMcp: 30, ringPip: 60 })],
  ['手首ひねり・低い位置', mk([-0.05, -0.15, 0.2], [-30, 50, -20], { indexMcp: -10, middleDip: 35 })],
  ['高い位置・掌屈', mk([0.15, 0.4, 0.35], [45, 30, 15], { ringMcp: 80, ringPip: 90, ringDip: 40 })],
];

describe('左右の決め方(MediaPipe の handedness)', () => {
  it('生のカメラ映像ではラベルと実際の手が逆、鏡像映像ではラベルどおり', () => {
    expect(resolveSide('Left', false)).toBe('right');
    expect(resolveSide('Right', false)).toBe('left');
    expect(resolveSide('Left', true)).toBe('left');
    expect(resolveSide('Right', true)).toBe('right');
  });
});

describe('ランドマーク -> 手の姿勢: 往復(姿勢 -> 合成ランドマーク -> 姿勢)', () => {
  for (const mirrored of [false, true]) {
    for (const side of ['right', 'left'] as const) {
      for (const [name, pose] of POSES) {
        it(`${name} / ${side}手 / 鏡像入力=${mirrored}: 位置・手首 euler・指 15 関節が一致`, () => {
          const settings: CaptureSettings = { ...DEFAULT_SETTINGS, mirroredInput: mirrored };
          const r = handToPose(synthesizeHand(pose, side, { settings }), settings);
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          expect(r.side).toBe(side);
          expectPoseClose(r.pose, pose);
        });
      }
    }
  }
  it('腕の長さで 0.6m 基準へ正規化される(腕 0.45m の人の位置は 0.6/0.45 倍)', () => {
    const settings: CaptureSettings = { ...DEFAULT_SETTINGS, armLength: 0.45 };
    const pose = POSES[1][1];
    const r = handToPose(synthesizeHand(pose, 'right', { settings }), settings);
    if (!r.ok) throw new Error('x');
    expectPoseClose(r.pose, pose);
    const raw = handToPose(synthesizeHand(pose, 'right', { settings }), { ...settings, armLength: 0.6 });
    if (!raw.ok) throw new Error('x');
    expect(raw.pose.wrist.position[0]).toBeCloseTo(pose.wrist.position[0] * 0.45 / 0.6, 6);
  });
  it('world 座標の原点(手の中心)の位置に依存しない', () => {
    const pose = POSES[1][1];
    const r = handToPose(synthesizeHand(pose, 'right', { worldOffset: [0.3, -0.2, 0.5] }), DEFAULT_SETTINGS);
    if (!r.ok) throw new Error('x');
    expectPoseClose(r.pose, pose);
  });
  it('実際の透視投影でも位置は数 cm 以内・向きは数度以内(弱透視近似の誤差)', () => {
    const pose = POSES[1][1];
    const r = handToPose(synthesizeHand(pose, 'right', { perspective: true }), DEFAULT_SETTINGS);
    if (!r.ok) throw new Error('x');
    r.pose.wrist.position.forEach((v, i) => expect(Math.abs(v - pose.wrist.position[i])).toBeLessThan(0.08));
    for (const j of FINGER_JOINTS) expect(angDiff(r.pose.joints[j][0], pose.joints[j][0])).toBeLessThan(1e-3); // world だけで決まる
  });
});

describe('座標・左右の規約(合成ランドマークの round trip に頼らない独立した期待)', () => {
  // 演者の右手を立て、手のひらをカメラへ向ける(ストップの形)。カメラ座標: +x 右 / +y 下 / +z 奥。
  // 指は上(-y)、手のひら法線はカメラ向き(-z)、母指側(示指)は画像の右(演者の左 = 体の内側)。
  const lm = (flexIndex: [number, number, number] = [0, 0, 0], wristX = 0.3): DetectedHand => {
    const world = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
    const set = (i: number, x: number, y: number, z: number): void => { world[i] = { x, y, z }; };
    set(0, 0, 0.05, 0);
    set(9, 0, -0.045, 0);
    set(5, 0.03, -0.04, 0);
    set(17, -0.03, -0.025, 0);
    set(13, -0.012, -0.035, 0);
    // 示指: 指先がカメラ側(-z)へ曲がる = 屈曲(手のひら側へ)
    let acc = 0;
    let p = { x: 0.03, y: -0.04, z: 0 };
    flexIndex.forEach((f, i) => {
      acc += (f * Math.PI) / 180;
      p = { x: p.x, y: p.y - 0.03 * Math.cos(acc), z: p.z - 0.03 * Math.sin(acc) };
      set(6 + i, p.x, p.y, p.z);
    });
    set(10, 0, -0.07, 0); set(11, 0, -0.09, 0); set(12, 0, -0.1, 0);
    set(14, -0.012, -0.065, 0); set(15, -0.012, -0.085, 0); set(16, -0.012, -0.095, 0);
    set(18, -0.03, -0.045, 0); set(19, -0.03, -0.06, 0); set(20, -0.03, -0.07, 0);
    set(1, 0.02, 0.02, 0); set(2, 0.04, 0, 0); set(3, 0.06, -0.02, 0); set(4, 0.07, -0.04, 0);
    const image = world.map((w) => ({ x: wristX + w.x, y: 0.4 + w.y, z: w.z }));
    return { label: 'Left', score: 0.9, landmarks: image, worldLandmarks: world };
  };
  it('生映像の MediaPipe "Left" は演者の右手。画像の左側にある手は演者の右(+x)', () => {
    const r = handToPose(lm(), DEFAULT_SETTINGS);
    if (!r.ok) throw new Error('x');
    expect(r.side).toBe('right');
    expect(r.pose.wrist.position[0]).toBeGreaterThan(0); // 画像 x=0.3(胸中央 0.5 より左)= 演者の右
  });
  it('同じ形を画像上で左右反転した手は左手で、規約値(右手と同じ値)に一致する', () => {
    const a = lm([30, 40, 20], 0.3);
    const mirror = (h: DetectedHand): DetectedHand => ({
      label: 'Right',
      score: h.score,
      landmarks: h.landmarks.map((l) => ({ ...l, x: 1 - l.x })),
      worldLandmarks: h.worldLandmarks.map((l) => ({ ...l, x: -l.x })),
    });
    const ra = handToPose(a, DEFAULT_SETTINGS);
    const rb = handToPose(mirror(a), DEFAULT_SETTINGS);
    if (!ra.ok || !rb.ok) throw new Error('x');
    expect(rb.side).toBe('left');
    expectPoseClose(rb.pose, ra.pose, 1e-9, 1e-7);
  });
  it('屈曲: 指先が手のひら側(カメラ側)へ曲がると正、反らすと負', () => {
    const r = handToPose(lm([40, 50, 20]), DEFAULT_SETTINGS);
    if (!r.ok) throw new Error('x');
    expect(r.pose.joints.indexMcp[0]).toBeCloseTo(40, 4);
    expect(r.pose.joints.indexPip[0]).toBeCloseTo(50, 4);
    expect(r.pose.joints.indexDip[0]).toBeCloseTo(20, 4);
    const back = handToPose(lm([-30, 0, 0]), DEFAULT_SETTINGS);
    if (!back.ok) throw new Error('x');
    expect(back.pose.joints.indexMcp[0]).toBeCloseTo(-30, 4);
    // 曲げていない指は 0 付近
    expect(Math.abs(r.pose.joints.middleMcp[0])).toBeLessThan(5);
  });
  it('手が近づく(画像上で大きい)と +z(演者の前方)、胸より上は +y', () => {
    const near = lm();
    const far: DetectedHand = { ...near, landmarks: near.landmarks.map((l) => ({ ...l, x: 0.5 + (l.x - 0.5) * 0.5, y: 0.4 + (l.y - 0.4) * 0.5 })) };
    const a = handToPose(near, DEFAULT_SETTINGS);
    const b = handToPose(far, DEFAULT_SETTINGS);
    if (!a.ok || !b.ok) throw new Error('x');
    expect(a.pose.wrist.position[2]).toBeGreaterThan(b.pose.wrist.position[2]); // 画像上で大きい = カメラに近い = 演者の前方
    expect(a.pose.wrist.position[1]).toBeGreaterThan(0); // 画像 y=0.45 は胸中央(0.8)より上
  });
  it('退化したランドマーク(点が足りない・NaN・手の大きさ 0)は ok:false', () => {
    const h = lm();
    expect(handToPose({ ...h, landmarks: h.landmarks.slice(0, 20) }, DEFAULT_SETTINGS).ok).toBe(false);
    expect(handToPose({ ...h, worldLandmarks: h.worldLandmarks.map((l, i) => (i === 3 ? { ...l, x: NaN } : l)) }, DEFAULT_SETTINGS).ok).toBe(false);
    const flatW = h.worldLandmarks.map(() => ({ x: 0, y: 0, z: 0 }));
    expect(handToPose({ ...h, worldLandmarks: flatW }, DEFAULT_SETTINGS).ok).toBe(false);
  });
});

describe('規約の突き合わせ(vrmPose.ts と同じ前腕基準・euler)', () => {
  it('手の基準フレーム = vrmPose の右手の基準フレーム(前腕方向を振って全部)', () => {
    for (let i = 0; i < 60; i++) {
      const u = new Vector3(Math.sin(i * 1.7) * Math.cos(i), Math.cos(i * 2.3), Math.sin(i) * Math.sin(i * 0.9)).normalize();
      const mine = handReferenceFrame([u.x, u.y, u.z]);
      const m = vrmReferenceFrame(u, 'right');
      const cols = [0, 1, 2].map((c) => new Vector3().setFromMatrixColumn(m, c));
      cols.forEach((v, c) => {
        expect(v.x).toBeCloseTo(mine[c][0], 9);
        expect(v.y).toBeCloseTo(mine[c][1], 9);
        expect(v.z).toBeCloseTo(mine[c][2], 9);
      });
    }
  });
  it('euler の行列表現は Three.js の Euler XYZ と一致し、往復する', () => {
    const e: V3 = [25, -40, 70];
    const m = eulerToMat(e);
    const back = matToEuler(m);
    back.forEach((v, i) => expect(v).toBeCloseTo(e[i], 9));
  });
  it('録画した手首の向きを VRM へ流すと、手のひらの向きが元のランドマークの手のひら法線と一致する(右手・左手)', () => {
    const rig = buildRig('stick-figure.vrm');
    for (const side of ['right', 'left'] as Side[]) {
      for (const [, pose] of POSES) {
        const hand = synthesizeHand(pose, side);
        const r = handToPose(hand, DEFAULT_SETTINGS);
        if (!r.ok) throw new Error('x');
        // 期待: 実際の演者の手のひら法線をモデル座標(VRM と同じ)で
        const pts = hand.worldLandmarks.map((l) => new Vector3(l.x, -l.y, -l.z));
        const Y = pts[9].clone().sub(pts[0]).normalize();
        const retargeted = retargetPose({ left: side === 'left' ? r.pose : REST_POSE.left, right: side === 'right' ? r.pose : REST_POSE.right }, rig.profile);
        const vrm = toVrmPose(retargeted, rig.profile, rig.rest);
        applyBones(rig, vrm.bones);
        const palm = new Vector3(0, -1, 0).applyQuaternion(rig.bones[`${side}Hand`].getWorldQuaternion(new Quaternion()));
        // 手のひらの向き(VRM ワールド) ≒ 実際の手のひら法線(実空間の外積: 指→示指側 の向きで定義)
        const realRad = pts[5].clone().sub(pts[17]);
        const realPalm = (side === 'right' ? realRad.clone().cross(Y) : Y.clone().cross(realRad)).normalize();
        expect(palm.angleTo(realPalm) * (180 / Math.PI), `${side}`).toBeLessThan(8);
      }
    }
  });
});

describe('時系列処理', () => {
  const ts = (n: number, f: (i: number) => number[] | null, dt = 1 / 30): Sample[] => Array.from({ length: n }, (_, i) => ({ t: i * dt, v: f(i) }));
  const v = (x: number): number[] => [x, 0, 0, 0, 0, 0, ...new Array(15).fill(0)];

  it('欠落フレームを線形補間する(短い欠落だけ。端は補間しない)', () => {
    const s = ts(10, (i) => (i === 3 || i === 4 ? null : i === 0 ? null : v(i * 0.01)));
    const r = fillGaps(s, 0.3);
    expect(r.samples[3].v?.[0]).toBeCloseTo(0.03, 9);
    expect(r.samples[4].v?.[0]).toBeCloseTo(0.04, 9);
    expect(r.samples[0].v).toBeNull(); // 先頭は前が無いので補間しない
    expect(r.longGaps).toEqual([]);
  });
  it('長い欠落(maxGap 超)は補間せず longGaps に長さを返す', () => {
    const s = ts(20, (i) => (i >= 5 && i < 15 ? null : v(i * 0.01)));
    const r = fillGaps(s, 0.3);
    expect(r.samples[10].v).toBeNull();
    expect(r.longGaps).toHaveLength(1);
    expect(r.longGaps[0]).toBeCloseTo(11 / 30, 9);
  });
  it('外れ値除去(チャンネル単位): 外れたチャンネルだけ NaN にし、他のチャンネルは残す。滑らかな大きな動きは残す', () => {
    const s = ts(15, (i) => v(i * 0.01));
    s[7] = { t: s[7].t, v: v(1.5) };
    s[10] = { t: s[10].t, v: [0.1, 0, 0, 170, 0, 0, ...new Array(15).fill(0)] };
    const r = removeOutliers(s);
    expect(r.removed).toBe(2);
    expect(r.samples[7].v?.[0]).toBeNaN();
    expect(r.samples[7].v?.[1]).toBe(0);
    expect(r.samples[10].v?.[3]).toBeNaN();
    expect(r.samples[10].v?.[0]).toBeCloseTo(0.1, 9); // 位置は残る
    const smoothRamp = ts(15, (i) => [0, 0, 0, i * 12, 0, 0, ...new Array(15).fill(0)]); // 1 フレーム 12° の速い回転
    expect(removeOutliers(smoothRamp).removed).toBe(0);
    // NaN は fillGaps が前後から補間する
    const f = fillGaps(r.samples, 0.3).samples;
    expect(f[7].v?.[0]).toBeCloseTo(0.07, 9);
    expect(f.every((x) => x.v?.every(Number.isFinite))).toBe(true);
  });
  it('外れ値の既定は近傍 3 つ以上で判定、手首 euler は範囲内なら 180 を超えても変えず ±360 に収める', () => {
    expect(DEFAULT_OUTLIER.minNeighbors).toBe(3);
    const two = ts(4, (i) => (i === 0 ? v(0) : i === 1 ? v(5) : null));
    expect(removeOutliers(two, { window: 2, positionThreshold: 0.12, angleThreshold: 70 }).removed).toBe(0);
    const w = wrapRotation([0, 0, 0, 200, -250, 400, ...new Array(15).fill(0)]);
    expect(w.slice(3, 6)).toEqual([200, -250, 40]);
  });
  it('外れ値除去: 窓の有効値が minNeighbors 未満なら判定しない(3 つあれば判定する)', () => {
    const two = ts(6, (i) => (i === 0 ? v(0) : i === 1 ? v(5) : null));
    expect(removeOutliers(two).removed).toBe(0);
    const three = ts(6, (i) => (i < 2 ? v(0) : i === 2 ? v(5) : null));
    expect(removeOutliers(three).removed).toBe(1);
  });
  it('欠落補間の境界: 前後の間隔が maxGap ちょうどなら補間、超えれば補間しない。チャンネル NaN の長い欠落は直前値で保持', () => {
    const at = (gapFrames: number): Sample[] => ts(gapFrames + 2, (i) => (i === 0 ? v(0) : i === gapFrames + 1 ? v(1) : null), 0.1);
    expect(fillGaps(at(2), 0.3).samples[1].v).not.toBeNull(); // 間隔 0.3
    expect(fillGaps(at(3), 0.3).samples[1].v).toBeNull(); // 間隔 0.4
    const nan = ts(8, (i) => (i === 0 ? v(0.5) : i === 7 ? v(0.9) : [NaN, ...v(0).slice(1)]), 0.2);
    expect(fillGaps(nan, 0.3).samples[3].v?.[0]).toBeCloseTo(0.5, 9);
    const edge = ts(4, (i) => (i === 0 ? v(0) : i === 3 ? v(0.3) : [NaN, ...v(0).slice(1)]), 0.1); // NaN の前後の間隔が 0.3 ちょうど
    expect(fillGaps(edge, 0.3).samples[1].v?.[0]).toBeCloseTo(0.1, 9);
    expect(fillGaps(edge, 0.29).samples[1].v?.[0]).toBeCloseTo(0, 9);
  });
  it('平滑: ノイズを減らし、零位相(ゆっくりした波はずれない)で、欠落をまたがない', () => {
    const noisy = ts(90, (i) => v(Math.sin((2 * Math.PI * i) / 90) * 0.2 + (i % 2 ? 0.02 : -0.02)));
    const out = smooth(noisy, 4);
    const rough = (a: Sample[]): number => a.slice(1).reduce((acc, s, i) => acc + Math.abs((s.v as number[])[0] - (a[i].v as number[])[0]), 0);
    expect(rough(out)).toBeLessThan(rough(noisy) * 0.5);
    // ピーク位置(i=22 付近)が動かない
    const peak = out.reduce((best, s, i) => ((s.v as number[])[0] > (out[best].v as number[])[0] ? i : best), 0);
    expect(Math.abs(peak - 22)).toBeLessThanOrEqual(2);
    // 欠落をまたいで混ざらない
    const gap = ts(10, (i) => (i === 5 ? null : v(i < 5 ? 0 : 1)));
    const g = smooth(gap, 4);
    expect(g[4].v?.[0]).toBeCloseTo(0, 9);
    expect(g[6].v?.[0]).toBeCloseTo(1, 9);
    expect(smooth(noisy, 0)[3].v).toEqual(noisy[3].v);
  });
  it('平滑の零位相: 1Hz の強い平滑でも波のピーク位置がずれない(後ろ向きパスがないと数フレーム遅れる)', () => {
    const clean = ts(90, (i) => v(Math.sin((2 * Math.PI * i) / 90)));
    const out = smooth(clean, 1);
    const peak = out.reduce((best, s, i) => ((s.v as number[])[0] > (out[best].v as number[])[0] ? i : best), 0);
    expect(Math.abs(peak - 22)).toBeLessThanOrEqual(1);
  });
  it('euler の ±180 またぎを unwrap し、ジャンプが外れ値扱いにならない', () => {
    const s = ts(8, (i) => [0, 0, 0, wrap180(170 + i * 4), 0, 0, ...new Array(15).fill(0)]);
    const u = unwrapRotation(s);
    expect(u[7].v?.[3]).toBeCloseTo(198, 9);
    expect(removeOutliers(u).removed).toBe(0);
  });
  it('keyframe 間引き: 直線は両端だけ、折れ点は残る、許容誤差が小さいほど多く残る', () => {
    const line = ts(30, (i) => v(i * 0.01));
    expect(decimate(line)).toEqual([0, 29]);
    const corner = ts(30, (i) => v(i < 15 ? i * 0.02 : 0.28 - (i - 14) * 0.02));
    expect(decimate(corner)).toEqual([0, 14, 29]);
    const wave = ts(60, (i) => v(Math.sin(i / 6) * 0.1));
    const loose = decimate(wave, { positionTolerance: 0.05, angleTolerance: 4 }).length;
    const tight = decimate(wave, { positionTolerance: 0.002, angleTolerance: 4 }).length;
    expect(tight).toBeGreaterThan(loose);
    // 間引き後の線形補間が元との差を許容内に収める
    const keep = decimate(wave, { positionTolerance: 0.005, angleTolerance: 4 });
    for (let i = 0; i < wave.length; i++) {
      const b = keep.findIndex((k) => k >= i);
      const hi = keep[b];
      const lo = keep[Math.max(0, b - (hi === i ? 0 : 1))];
      const u = hi === lo ? 0 : (wave[i].t - wave[lo].t) / (wave[hi].t - wave[lo].t);
      const interp = (wave[lo].v as number[])[0] + ((wave[hi].v as number[])[0] - (wave[lo].v as number[])[0]) * u;
      expect(Math.abs(interp - (wave[i].v as number[])[0])).toBeLessThanOrEqual(0.005 + 1e-12);
    }
  });
  it('角度チャンネルの許容誤差(度)も効く', () => {
    const rot = ts(40, (i) => [0, 0, 0, Math.sin(i / 5) * 30, 0, 0, ...new Array(15).fill(0)]);
    expect(decimate(rot, { positionTolerance: 0.01, angleTolerance: 1 }).length).toBeGreaterThan(decimate(rot, { positionTolerance: 0.01, angleTolerance: 10 }).length);
  });
  it('channels <-> HandPose の往復', () => {
    const p = POSES[1][1];
    expect(channelsToPose(poseToChannels(p))).toEqual(p);
  });
});

/** 解析的な動き: 右手が左右に振れ、指が曲がる。30fps */
function analyticFrames(seconds: number, opts: { dropAt?: number[]; glitchAt?: number[]; fps?: number } = {}): { frames: CaptureFrame[]; truth: (t: number) => HandPose } {
  const fps = opts.fps ?? 30;
  const truth = (t: number): HandPose => {
    const c = (Math.sin(t * 3) + 1) / 2;
    return mk([0.05 + 0.2 * c, 0.1 + 0.1 * Math.sin(t * 2), 0.25], [10 * Math.sin(t * 2), 20 * c, 0], { indexMcp: 70 * c, indexPip: 60 * c, middleMcp: 40 * c, thumbCmc: 20 * c });
  };
  const frames: CaptureFrame[] = [];
  for (let i = 0; i <= Math.round(seconds * fps); i++) {
    const t = i / fps;
    let hands: DetectedHand[] = [synthesizeHand(truth(t), 'right')];
    if (opts.dropAt?.includes(i)) hands = [];
    if (opts.glitchAt?.includes(i)) hands = [synthesizeHand(mk([0.9, -0.8, 0.9], [150, 80, 0], { indexMcp: 150 }), 'right')];
    frames.push({ time: t, hands });
  }
  return { frames, truth };
}

describe('録画 -> motion 定義', () => {
  it('motion スキーマを通り、category=sign-like-gesture・provenance=unreviewed・source 固定', () => {
    const { frames } = analyticFrames(2);
    const r = buildRecordedMotion(frames, { id: 'rec-1', label: 'テスト', profile });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(validateMotion(JSON.parse(JSON.stringify(r.motion))).ok).toBe(true);
    expect(r.motion.category).toBe('sign-like-gesture');
    expect(r.motion.provenance).toEqual({ status: 'unreviewed', source: RECORDED_SOURCE });
    expect(r.motion.semantic.label).toBe('テスト');
    expect(r.motion.keyframes[0].time).toBe(0);
    expect(r.motion.duration).toBeCloseTo(2, 2);
    expect(r.motion.keyframes.every((k) => k.pose.right && !k.pose.left)).toBe(true);
  });
  it('再生した姿勢が元の動きに許容誤差内で一致し、keyframe は間引かれている', () => {
    const { frames, truth } = analyticFrames(2);
    const r = buildRecordedMotion(frames, { id: 'rec-1', label: '語' });
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.stats.keyframes).toBeLessThan(frames.length / 2);
    for (let t = 0.3; t < 1.7; t += 0.05) {
      const got = samplePose(r.motion, t).right;
      const want = truth(t);
      got.wrist.position.forEach((x, i) => expect(Math.abs(x - want.wrist.position[i]), `pos ${t}`).toBeLessThan(0.03));
      expect(angDiff(got.joints.indexMcp[0], want.joints.indexMcp[0]), `index ${t}`).toBeLessThan(10);
      expect(rotAngle(got.wrist.rotation, want.wrist.rotation), `rot ${t}`).toBeLessThan(6);
    }
  });
  it('欠落フレームは補間され、外れ値(一瞬別の姿勢)は除かれる', () => {
    const clean = analyticFrames(2);
    const dirty = analyticFrames(2, { dropAt: [20, 21, 22], glitchAt: [35] });
    const a = buildRecordedMotion(clean.frames, { id: 'a', label: '語' });
    const b = buildRecordedMotion(dirty.frames, { id: 'b', label: '語' });
    if (!a.ok || !b.ok) throw new Error('x');
    expect(b.warnings.some((w) => w.kind === 'outliers')).toBe(true);
    for (const t of [0.5, 0.7, 1.0, 1.17, 1.3]) {
      const pa = samplePose(a.motion, t).right.wrist.position;
      const pb = samplePose(b.motion, t).right.wrist.position;
      pa.forEach((x, i) => expect(Math.abs(x - pb[i])).toBeLessThan(0.03));
    }
  });
  it('トリミング: 開始/終了で区間が切り出され、時刻は 0 から', () => {
    const { frames } = analyticFrames(3);
    const r = buildRecordedMotion(frames, { id: 'a', label: '語', trim: { start: 1, end: 2 } });
    if (!r.ok) throw new Error('x');
    expect(r.motion.keyframes[0].time).toBe(0);
    expect(r.motion.duration).toBeCloseTo(1, 1);
    expect(buildRecordedMotion(frames, { id: 'a', label: '語', trim: { start: 2, end: 1 } }).ok).toBe(false);
  });
  it('両手: 左右が別の track として keyframe に入る(左は右手規約の値)', () => {
    const frames: CaptureFrame[] = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      const p = mk([0.1 + 0.1 * t, 0.1, 0.25], [0, 0, 0], { indexMcp: 30 });
      frames.push({ time: t, hands: [synthesizeHand(p, 'right'), synthesizeHand(p, 'left')] });
    }
    const r = buildRecordedMotion(frames, { id: 'both', label: '両手' });
    if (!r.ok) throw new Error(r.errors.join());
    const last = r.motion.keyframes[r.motion.keyframes.length - 1].pose;
    expect(last.left?.wrist.position[0]).toBeCloseTo(0.2, 2);
    expect(last.right?.wrist.position[0]).toBeCloseTo(0.2, 2);
  });
  it('可動域外は clamp せず警告として返す(値はそのまま)', () => {
    const frames: CaptureFrame[] = [];
    for (let i = 0; i <= 30; i++) frames.push({ time: i / 30, hands: [synthesizeHand(mk([0.1, 0.1, 0.25], [0, 0, 0], { indexMcp: -50, middleMcp: 60 }), 'right')] });
    const r = buildRecordedMotion(frames, { id: 'rom', label: '語', profile });
    if (!r.ok) throw new Error(r.errors.join());
    const w = r.warnings.filter((x) => x.kind === 'range');
    const idx = w.find((x) => x.kind === 'range' && x.joint === 'indexMcp');
    expect(idx).toBeDefined();
    expect(idx?.kind === 'range' && idx.min).toBeCloseTo(-50, 0);
    expect(r.motion.keyframes[0].pose.right?.joints.indexMcp[0]).toBeCloseTo(-50, 1);
    expect(w.some((x) => x.kind === 'range' && x.joint === 'middleMcp')).toBe(false);
    expect(rangeWarnings(r.motion, profile)).toEqual(w);
  });
  it('エラー系: 検出なし / 短すぎる / ラベル空 / id 不正 / 腕の長さ不正', () => {
    const none: CaptureFrame[] = Array.from({ length: 30 }, (_, i) => ({ time: i / 30, hands: [] }));
    expect(buildRecordedMotion(none, { id: 'a', label: '語' })).toMatchObject({ ok: false });
    const { frames } = analyticFrames(2);
    expect(buildRecordedMotion(frames.slice(0, 2), { id: 'a', label: '語' })).toMatchObject({ ok: false });
    expect(buildRecordedMotion(frames.slice(0, 3), { id: 'a', label: '語' })).toMatchObject({ ok: false });
    expect(buildRecordedMotion(frames, { id: 'a', label: '  ' })).toMatchObject({ ok: false });
    expect(buildRecordedMotion(frames, { id: 'A b', label: '語' })).toMatchObject({ ok: false });
    expect(buildRecordedMotion(frames, { id: 'a', label: '語', settings: { ...DEFAULT_SETTINGS, armLength: 2 } })).toMatchObject({ ok: false });
    expect(buildRecordedMotion([], { id: 'a', label: '語' })).toMatchObject({ ok: false });
  });
  it('一瞬しか映らなかった手は捨てて警告する', () => {
    const { frames } = analyticFrames(1);
    const f = frames.map((fr, i) => (i < 2 ? fr : { ...fr, hands: [] }));
    const r = buildRecordedMotion(f, { id: 'a', label: '語' });
    expect(r.ok).toBe(false);
  });
  it('録画 motion の文字列に、手話そのものを名乗る文言がない', () => {
    const { frames } = analyticFrames(1);
    const r = buildRecordedMotion(frames, { id: 'a', label: '語' });
    if (!r.ok) throw new Error('x');
    expect(JSON.stringify(r.motion)).not.toMatch(/手話通訳|手話翻訳|手話対応/);
    expect(RECORDED_SOURCE).toMatch(/not a reviewed sign/);
  });
});

describe('語彙への追加(実行時)', () => {
  it('録画 motion を追加すると字幕のその語が身振りになる。元の語彙は変わらない。同じ id は置き換え', () => {
    const { frames } = analyticFrames(1);
    const r = buildRecordedMotion(frames, { id: 'rec-hello', label: 'やっほー' });
    if (!r.ok) throw new Error('x');
    const before = textToSequence('やっほー 好き');
    expect(before[0].kind).toBe('unknown');
    const vocab = addMotionToVocabulary(DEFAULT_VOCABULARY, r.motion);
    const seq = textToSequence('やっほー 好き', vocab);
    expect(seq.map((s) => s.kind)).toEqual(['motion', 'motion']);
    expect(seq[0].kind === 'motion' && seq[0].motion.id).toBe('rec-hello');
    expect(DEFAULT_VOCABULARY.some((e) => e.motion.id === 'rec-hello')).toBe(false);
    expect(addMotionToVocabulary(vocab, r.motion)).toHaveLength(vocab.length);
    const plan = planFromText('1\n00:00:00,000 --> 00:00:03,000\nやっほー', 'auto', { kind: 'caption-wipe' }, vocab);
    if (!plan.ok) throw new Error('x');
    expect(plan.timeline.segments[0].gestures?.segments[0].motion?.id).toBe('rec-hello');
    const without = planFromText('1\n00:00:00,000 --> 00:00:03,000\nやっほー', 'auto', { kind: 'caption-wipe' });
    if (!without.ok) throw new Error('x');
    expect(without.timeline.segments[0].unsupported).toEqual(['やっほー']);
  });
  it('既存の語と同じ語を録画すると、録画の方が優先される', () => {
    const { frames } = analyticFrames(1);
    const r = buildRecordedMotion(frames, { id: 'rec-suki', label: '好き' });
    if (!r.ok) throw new Error('x');
    const seq = textToSequence('好き', addMotionToVocabulary(DEFAULT_VOCABULARY, r.motion));
    expect(seq[0].kind === 'motion' && seq[0].motion.id).toBe('rec-suki');
  });
});

describe('カメラ/モデルのエラー分類', () => {
  const dom = (name: string): Error => Object.assign(new Error(name), { name });
  it('権限拒否 / デバイスなし / 使用中 / 未対応 / その他', () => {
    expect(classifyCameraError(dom('NotAllowedError'))).toBe('denied');
    expect(classifyCameraError(dom('SecurityError'))).toBe('denied');
    expect(classifyCameraError(dom('NotFoundError'))).toBe('no-device');
    expect(classifyCameraError(dom('NotReadableError'))).toBe('in-use');
    expect(classifyCameraError(dom('TypeError'))).toBe('unsupported');
    expect(classifyCameraError(new Error('x'))).toBe('unknown');
    expect(classifyCameraError(null)).toBe('unknown');
  });
  it('モデル取得の失敗はすべて model-unavailable', () => {
    expect(classifyModelError(new TypeError('Failed to fetch'))).toBe('model-unavailable');
  });
});

describe('前腕の推定', () => {
  it('手首が胸の前にあるとき前腕は前向き・上に上げるほど上向き(単位ベクトル)', () => {
    const low = estimateForearm([0, -0.1, 0.3]);
    const high = estimateForearm([0, 0.3, 0.3]);
    expect(Math.hypot(...low)).toBeCloseTo(1, 9);
    expect(low[2]).toBeGreaterThan(0);
    expect(high[1]).toBeGreaterThan(low[1]);
  });
});

describe('録画 UI の文言', () => {
  const FORBIDDEN = /手話通訳|手話翻訳|手話対応/;
  it('手話そのものを名乗る文言がなく、未監修・保存しない旨がある', () => {
    const all = [REC_TITLE, REC_NOTICE, REC_MODEL_NOTE, REC_VOCAB_NOTE, ...Object.values(CAPTURE_ERROR_LABELS), ...Object.values(REC_STATUS), detectionLabel([]), detectionLabel(['left', 'right'])];
    for (const t of all) expect(t).not.toMatch(FORBIDDEN);
    expect(REC_NOTICE).toMatch(/保存も送信もしません/);
    expect(REC_NOTICE).toMatch(/未監修の手話風身振り/);
    expect(UNREVIEWED_BADGE).toBe('未監修・手話風身振り');
    expect(detectionLabel([])).toMatch(/検出なし/);
  });
  it('警告の文言: 可動域外は clamp しないと明記、すべての種類が文字列になる', () => {
    const line = captureWarningLine({ kind: 'range', side: 'right', joint: 'indexMcp', axis: 'x', count: 2, min: -60, max: -50, limit: [-20, 90] });
    expect(line).toMatch(/そのまま残/);
    for (const w of [{ kind: 'dropped-hand', side: 'left', frames: 2 }, { kind: 'duplicate-side', side: 'left', frames: 2 }, { kind: 'outliers', side: 'right', frames: 3 }, { kind: 'long-gap', side: 'right', seconds: 0.5 }] as const) {
      expect(captureWarningLine(w)).not.toMatch(FORBIDDEN);
    }
  });
  it('カメラのエラー種別ごとに文言がある(権限拒否 / なし / 使用中 / 未対応 / モデル取得失敗)', () => {
    for (const k of ['denied', 'no-device', 'in-use', 'unsupported', 'model-unavailable', 'unknown'] as const) expect(CAPTURE_ERROR_LABELS[k].length).toBeGreaterThan(5);
    expect(CAPTURE_ERROR_LABELS['model-unavailable']).toMatch(/モデル/);
  });
});

describe('手首 euler のジンバル付近(y = ±90°)', () => {
  const run = (y: (i: number) => number, side: Side = 'right'): { got: Vec3; want: Vec3 }[] => {
    const frames: CaptureFrame[] = [];
    const truth = (i: number): HandPose => mk([0.1, 0.1, 0.25], [20, y(i), 10], { indexMcp: 20 });
    for (let i = 0; i <= 60; i++) frames.push({ time: i / 30, hands: [synthesizeHand(truth(i), side)] });
    const r = buildRecordedMotion(frames, { id: 'g', label: '語' });
    if (!r.ok) throw new Error(r.errors.join());
    const out: { got: Vec3; want: Vec3 }[] = [];
    for (let t = 0.2; t < 1.8; t += 0.1) out.push({ got: samplePose(r.motion, t)[side].wrist.rotation, want: truth(Math.round(t * 30)).wrist.rotation });
    return out;
  };
  for (const [name, y] of [['90±0.5', (i: number) => 90 + (i % 2 ? 0.5 : -0.5)], ['-90±1', (i: number) => -90 + (i % 2 ? 1 : -1)], ['85(対照)', () => 85], ['88(対照)', () => 88]] as const) {
    it(`y=${name}: 再生の向き誤差が数度以内(右手・左手)`, () => {
      for (const side of ['right', 'left'] as const) for (const { got, want } of run(y, side)) expect(rotAngle(got, want)).toBeLessThan(4);
    });
  }
  it('等価解の選択: unwrapRotation は直前に近い方を選び、y が 90 を超えて続いてよい', () => {
    const rot = (x: number, y: number, z: number): Sample => ({ t: 0, v: [0, 0, 0, x, y, z, ...new Array(15).fill(0)] });
    const out = unwrapRotation([rot(20, 89.5, 10), rot(20 + 180, 180 - 90.5, 10 - 180), rot(20, 89.5, 10)].map((x, i) => ({ ...x, t: i })));
    expect(out[1].v?.slice(3, 6)).toEqual([20, 90.5, 10]); // 分解が (200, 89.5, -170) へ飛んでも、直前に近い等価解(y が 90 を超える)を選ぶ
    const high = unwrapRotation([rot(20, 85, 10), rot(200, 88, -170)].map((x, i) => ({ ...x, t: i })));
    expect(high[1].v?.[4]).toBeCloseTo(92, 9);
  });
});

describe('母指が横に開いたときの屈曲角の安定', () => {
  /** 母指 2-4 を X'(橈側)方向へ伸ばし、world に ±3mm のノイズを乗せる */
  const frames = (): CaptureFrame[] => {
    const out: CaptureFrame[] = [];
    let seed = 7;
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.006; };
    for (let i = 0; i <= 60; i++) {
      const h = synthesizeHand(mk([0.1, 0.1, 0.25], [0, 0, 0]), 'right');
      const w = h.worldLandmarks.map((l) => ({ ...l }));
      const sub = (a: number, b: number): [number, number, number] => [w[a].x - w[b].x, w[a].y - w[b].y, w[a].z - w[b].z];
      const rad = sub(5, 17);
      const n = Math.hypot(...rad);
      for (const [id, d] of [[2, 0.03], [3, 0.055], [4, 0.075]] as const) {
        w[id] = { x: w[1].x + (rad[0] / n) * d + rnd(), y: w[1].y + (rad[1] / n) * d + rnd(), z: w[1].z + (rad[2] / n) * d + rnd() };
      }
      out.push({ time: i / 30, hands: [{ ...h, worldLandmarks: w }] });
    }
    return out;
  };
  it('不安定な母指の角度は NaN になり(閾値 MIN_PLANE_RATIO)、他の指の角度は有限', () => {
    const r = handToPose(frames()[0].hands[0], DEFAULT_SETTINGS);
    if (!r.ok) throw new Error('x');
    expect(MIN_PLANE_RATIO).toBeGreaterThan(0);
    expect(Number.isNaN(r.pose.joints.thumbMcp[0])).toBe(true);
    expect(Number.isFinite(r.pose.joints.indexMcp[0])).toBe(true);
    expect(Number.isFinite(r.pose.wrist.rotation[0])).toBe(true);
  });
  it('フレーム全体が外れ値で捨てられず、手首と他の指は全フレーム残り、motion は有限値で通る', () => {
    const fs = frames();
    const samples: Sample[] = fs.map((f) => {
      const r = handToPose(f.hands[0], DEFAULT_SETTINGS);
      return { t: f.time, v: r.ok ? poseToChannels(r.pose) : null };
    });
    const cleaned = removeOutliers(unwrapRotation(samples));
    // 手首(0-5)・示指〜小指(9-20)のチャンネルは全フレームで有限(捨てられていない)
    for (const x of cleaned.samples) for (const c of [0, 1, 2, 3, 4, 5, ...Array.from({ length: 12 }, (_, i) => 9 + i)]) expect(Number.isFinite(x.v?.[c] as number)).toBe(true);
    const r = buildRecordedMotion(fs, { id: 'thumb', label: '語' });
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.motion.keyframes.every((k) => Object.values(k.pose.right?.joints ?? {}).every((j) => j.every(Number.isFinite)))).toBe(true);
    expect(Math.abs(r.motion.keyframes[0].pose.right?.joints.indexMcp[0] ?? 99)).toBeLessThan(5);
  });
});

describe('録画パイプラインの境界', () => {
  const clean = (n = 60, score = 0.9) => {
    const fr: CaptureFrame[] = [];
    for (let i = 0; i <= n; i++) {
      const c = i / n;
      fr.push({ time: i / 30, hands: [{ ...synthesizeHand(mk([0.05 + 0.2 * c, 0.1, 0.25], [0, 0, 0], { indexMcp: 40 * c }), 'right'), score }] });
    }
    return fr;
  };
  it('同じ側が複数検出されたらスコアの高い方を使う(順序によらない)', () => {
    const good = clean();
    const bogus = (h: DetectedHand): DetectedHand => ({ ...synthesizeHand(mk([-0.2, -0.3, 0.1], [0, 0, 0], { indexMcp: 80 }), 'right'), score: 0.2 });
    for (const lowFirst of [true, false]) {
      const fr = good.map((f) => ({ ...f, hands: lowFirst ? [bogus(f.hands[0]), f.hands[0]] : [f.hands[0], bogus(f.hands[0])] }));
      const r = buildRecordedMotion(fr, { id: 'd', label: '語' });
      const ref = buildRecordedMotion(good, { id: 'd', label: '語' });
      if (!r.ok || !ref.ok) throw new Error('x');
      expect(r.motion).toEqual(ref.motion);
      expect(r.warnings.some((w) => w.kind === 'duplicate-side')).toBe(true);
    }
  });
  it('フレームは時刻順に並べ直し、1ms 未満で重なる重複時刻は捨てる', () => {
    const fr = clean();
    const ref = buildRecordedMotion(fr, { id: 'o', label: '語' });
    const rev = buildRecordedMotion([...fr].reverse(), { id: 'o', label: '語' });
    if (!ref.ok || !rev.ok) throw new Error('x');
    expect(rev.motion).toEqual(ref.motion);
    expect(rev.stats.frames).toBe(fr.length);
    const dup = buildRecordedMotion(fr.flatMap((f) => [f, { ...f, time: f.time + 0.0005 }]), { id: 'o', label: '語' });
    if (!dup.ok) throw new Error('x');
    expect(dup.stats.frames).toBe(fr.length);
    expect(dup.motion).toEqual(ref.motion);
  });
  it('2 フレームしか映らなかった手は dropped-hand 警告で捨てる(最低 3 フレーム)', () => {
    const fr = clean().map((f, i) => ({ ...f, hands: i < 2 ? [...f.hands, synthesizeHand(mk([0.1, 0.1, 0.25], [0, 0, 0]), 'left')] : f.hands }));
    const r = buildRecordedMotion(fr, { id: 'm', label: '語' });
    if (!r.ok) throw new Error('x');
    expect(r.warnings).toContainEqual({ kind: 'dropped-hand', side: 'left', frames: 2 });
    expect(r.motion.keyframes.every((k) => !k.pose.left)).toBe(true);
  });
  it('欠落の既定 maxGap=0.3 秒: 0.3 秒の欠落は補間し、それより長いと long-gap 警告', () => {
    const drop = (n: number): CaptureFrame[] => clean().map((f, i) => (i >= 20 && i < 20 + n ? { ...f, hands: [] } : f));
    const ok = buildRecordedMotion(drop(8), { id: 'g', label: '語' }); // 前後の間隔 9/30 = 0.3
    const long = buildRecordedMotion(drop(9), { id: 'g', label: '語' }); // 10/30
    if (!ok.ok || !long.ok) throw new Error('x');
    expect(ok.warnings.some((w) => w.kind === 'long-gap')).toBe(false);
    expect(long.warnings.some((w) => w.kind === 'long-gap')).toBe(true);
  });
  it('トリム: 区間に 2 サンプル未満しか残らなければ検出なし扱いのエラー。開始=終了もエラー', () => {
    const fr = clean();
    const r = buildRecordedMotion(fr, { id: 't', label: '語', trim: { start: 1, end: 1.01 } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.join()).toMatch(/有効な手/);
    expect(buildRecordedMotion(fr, { id: 't', label: '語', trim: { start: 1, end: 1 } })).toMatchObject({ ok: false });
  });
  it('可動域警告: 件数と最小/最大を側・関節・軸ごとに集計する(clamp しない)', () => {
    const mkKf = (time: number, x: number): { time: number; pose: { right: HandPose } } => ({ time, pose: { right: mk([0, 0, 0.2], [0, 0, 0], { indexMcp: x }) } });
    const m = { schemaVersion: '0.1.0', id: 'r', category: 'sign-like-gesture', provenance: { status: 'unreviewed' }, semantic: { label: 'r' }, duration: 3, keyframes: [mkKf(0, -30), mkKf(1, 10), mkKf(2, -50), mkKf(3, -40)] } as unknown as Parameters<typeof rangeWarnings>[0];
    const w = rangeWarnings(m, profile).filter((x) => x.joint === 'indexMcp');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ side: 'right', axis: 'x', count: 3, min: -50, max: -30, limit: [-20, 90] });
  });
});

describe('語彙の最長一致の計算量', () => {
  it('1〜2 文字の録画ラベルを重ねて追加しても、長い連続入力が線形時間で終わる', () => {
    const { frames } = analyticFrames(1);
    const r1 = buildRecordedMotion(frames, { id: 'rec-a', label: 'あ' });
    const r2 = buildRecordedMotion(frames, { id: 'rec-aa', label: 'ああ' });
    if (!r1.ok || !r2.ok) throw new Error('x');
    const vocab = addMotionToVocabulary(addMotionToVocabulary(DEFAULT_VOCABULARY, r1.motion), r2.motion);
    const t0 = performance.now();
    const seq = textToSequence('あ'.repeat(40) + 'x', vocab);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(seq.length).toBeGreaterThan(0);
  });
});

describe('CSP(外部への接続を絞る)', () => {
  const html = (Object.values(import.meta.glob('../index.html', { query: '?raw', import: 'default', eager: true }))[0] as string);
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
  const directive = (name: string): string[] => (csp.split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === name) ?? []).slice(1);
  it('odml(利用統計)は許可されず、外部の許可は storage.googleapis.com(モデル取得)だけ', () => {
    expect(csp).not.toBe('');
    expect(csp).not.toMatch(/odml|googleapis\.com\/v1\/log|\*/);
    const external = csp.replace(/;/g, ' ').split(/\s+/).filter((t) => /^(https?|wss?):/.test(t));
    expect(external).toEqual(['https://storage.googleapis.com']);
    expect(directive('connect-src')).toEqual(["'self'", 'blob:', 'data:', 'https://storage.googleapis.com']);
    expect(directive('script-src')).toEqual(["'self'", "'unsafe-eval'", "'wasm-unsafe-eval'"]); // unsafe-eval は ajv のスキーマ検証器の生成(new Function)に必要。外部スクリプトは許可しない
    expect(directive('default-src')).toEqual(["'self'"]);
  });
});

describe('カメラのエラー分類(追加)', () => {
  it('OverconstrainedError は no-device', () => {
    expect(classifyCameraError(Object.assign(new Error('x'), { name: 'OverconstrainedError' }))).toBe('no-device');
  });
});
