import { describe, expect, it } from 'vitest';
import { applyEase, lerpHandPose, lerpVec3, samplePose, sampleTrack } from '../src/motion/interpolate';
import { REST_POSE } from '../src/motion/rest';
import { validateMotion } from '../src/validate';
import type { HandPose, MotionDefinition } from '../src/types/definition';
import { typedFullMotion } from './typed-samples';

const clone = <T>(x: T): any => JSON.parse(JSON.stringify(x));
const ZERO_JOINTS = clone(REST_POSE.right.joints);
const hand = (x: number, rotX = 0): HandPose => ({ wrist: { position: [x, 0, 0], rotation: [rotX, 0, 0] }, joints: ZERO_JOINTS });

function motion(kfs: { time: number; x: number; ease?: string; hold?: number }[], duration: number, side: 'left' | 'right' = 'right'): MotionDefinition {
  const m = clone(typedFullMotion);
  m.duration = duration;
  m.keyframes = kfs.map((k) => ({ time: k.time, ...(k.ease ? { ease: k.ease } : {}), ...(k.hold ? { hold: k.hold } : {}), pose: { [side]: hand(k.x) } }));
  return m;
}
const x = (m: MotionDefinition, t: number, side: 'left' | 'right' = 'right') => samplePose(m, t)[side].wrist.position[0];

describe('applyEase', () => {
  it('端点は0と1、範囲外はクランプ', () => {
    for (const e of ['linear', 'ease-in', 'ease-out', 'ease-in-out', undefined] as const) {
      expect(applyEase(e, 0)).toBe(0);
      expect(applyEase(e, 1)).toBe(1);
      expect(applyEase(e, -1)).toBe(0);
      expect(applyEase(e, 2)).toBe(1);
    }
  });
  it('中間値: ease-in は遅れ、ease-out は先行、ease-in-out は中点0.5', () => {
    expect(applyEase('linear', 0.25)).toBeCloseTo(0.25);
    expect(applyEase('ease-in', 0.5)).toBeCloseTo(0.25);
    expect(applyEase('ease-out', 0.5)).toBeCloseTo(0.75);
    expect(applyEase('ease-in-out', 0.5)).toBeCloseTo(0.5);
    expect(applyEase('ease-in-out', 0.25)).toBeCloseTo(0.125);
    expect(applyEase('ease-in-out', 0.75)).toBeCloseTo(0.875);
  });
  it('単調非減少', () => {
    for (const e of ['ease-in', 'ease-out', 'ease-in-out'] as const) {
      let prev = -1;
      for (let i = 0; i <= 20; i++) {
        const v = applyEase(e, i / 20);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });
});

describe('samplePose: keyframe 補間', () => {
  it('linear で区間中点は中間値、端点はキーフレーム値', () => {
    const m = motion([{ time: 0, x: 0, ease: 'linear' }, { time: 1, x: 1 }], 1);
    expect(x(m, 0)).toBe(0);
    expect(x(m, 0.5)).toBeCloseTo(0.5);
    expect(x(m, 1)).toBe(1);
  });
  it('ease は出発側キーフレームの値が区間に掛かる', () => {
    const m = motion([{ time: 0, x: 0, ease: 'ease-in' }, { time: 1, x: 1 }], 1);
    expect(x(m, 0.5)).toBeCloseTo(0.25);
    const m2 = motion([{ time: 0, x: 0, ease: 'ease-out' }, { time: 1, x: 1 }], 1);
    expect(x(m2, 0.5)).toBeCloseTo(0.75);
  });
  it('hold 中は動かず、hold 終了から次キーフレームへ補間', () => {
    const m = motion([{ time: 0, x: 0, hold: 0.4, ease: 'linear' }, { time: 1, x: 1 }], 1);
    expect(x(m, 0.2)).toBe(0);
    expect(x(m, 0.4)).toBe(0);
    expect(x(m, 0.7)).toBeCloseTo(0.5);
    expect(x(m, 1)).toBe(1);
  });
  it('範囲外の時刻は端のポーズを保持', () => {
    const m = motion([{ time: 0.2, x: 0.3 }, { time: 0.8, x: 0.9 }], 1);
    expect(x(m, -5)).toBe(0.3);
    expect(x(m, 0.1)).toBe(0.3);
    expect(x(m, 99)).toBe(0.9);
  });
  it('3キーフレーム以上で区間ごとに補間', () => {
    const m = motion([{ time: 0, x: 0, ease: 'linear' }, { time: 1, x: 1, ease: 'linear' }, { time: 2, x: 0 }], 2);
    expect(x(m, 0.5)).toBeCloseTo(0.5);
    expect(x(m, 1.5)).toBeCloseTo(0.5);
    expect(x(m, 1)).toBe(1);
  });
  it('指定のない手は待機姿勢、指定がある手の欠けたキーフレームは前後で補間', () => {
    const m = motion([{ time: 0, x: 0, ease: 'linear' }, { time: 1, x: 1 }], 1);
    expect(samplePose(m, 0.5).left).toEqual(REST_POSE.left);
    // 左右で片手だけのキーフレームを混ぜる: right が time 0 と 2 にだけある
    const m2 = clone(m);
    m2.duration = 2;
    m2.keyframes = [
      { time: 0, ease: 'linear', pose: { right: hand(0) } },
      { time: 1, pose: { left: hand(5) } },
      { time: 2, pose: { right: hand(2) } },
    ];
    expect(x(m2, 1)).toBeCloseTo(1);
  });
  it('関節回転とアームも補間される', () => {
    const m = clone(typedFullMotion) as MotionDefinition;
    const p = samplePose(m, 0);
    expect(p.right.joints.indexMcp).toHaveLength(3);
    const a = hand(0, 0);
    const b = hand(0, 40);
    const track = [{ kf: { time: 0, ease: 'linear', pose: { right: a } } as any, hand: a }, { kf: { time: 1, pose: { right: b } } as any, hand: b }];
    expect(sampleTrack(track, 0.5)!.wrist.rotation[0]).toBeCloseTo(20);
  });
  it('lerpVec3', () => {
    expect(lerpVec3([0, 0, 0], [10, 20, 30], 0.5)).toEqual([5, 10, 15]);
  });
  it('プリセット全件で時間全域に NaN が出ない', async () => {
    const { PRESET_MOTIONS } = await import('../src/text/presets');
    for (const pm of PRESET_MOTIONS) {
      for (let t = 0; t <= pm.duration; t += 0.05) {
        const p = samplePose(pm, t);
        for (const h of [p.left, p.right]) {
          expect(h.wrist.position.every(Number.isFinite)).toBe(true);
          expect(Object.values(h.joints).flat().every(Number.isFinite)).toBe(true);
        }
      }
    }
    expect(validateMotion(PRESET_MOTIONS[0]).ok).toBe(true);
  });
  it('指関節も補間される(中間値)', () => {
    const a = hand(0);
    const b = clone(hand(0)) as any;
    b.joints.indexPip = [80, 0, 10];
    b.joints.thumbCmc = [0, 40, 0];
    const mid = lerpHandPose(a, b, 0.5);
    expect(mid.joints.indexPip).toEqual([40, 0, 5]);
    expect(mid.joints.thumbCmc).toEqual([0, 20, 0]);
    expect(mid.joints.middleDip).toEqual([0, 0, 0]);
  });
  it('arm が片側にしかなくても消えず、両側にあれば補間される', () => {
    const a = clone(hand(0)) as any;
    a.arm = { elbow: [100, 0, 0], shoulder: [10, 0, 0] };
    const b = hand(0);
    expect(lerpHandPose(a, b, 0.5).arm).toEqual(a.arm);
    expect(lerpHandPose(b, a, 0.5).arm).toEqual(a.arm);
    const c = clone(hand(0)) as any;
    c.arm = { elbow: [0, 0, 0] };
    const mid = lerpHandPose(a, c, 0.5).arm!;
    expect(mid.elbow).toEqual([50, 0, 0]);
    expect(mid.shoulder).toEqual([10, 0, 0]);
  });
});
