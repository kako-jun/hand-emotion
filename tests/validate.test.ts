import { describe, expect, it } from 'vitest';
import motionSample from '../samples/arigatou.motion.json';
import profileSample from '../samples/vrm1-humanoid.avatar-profile.json';
import {
  checkRangeOfMotion,
  isReviewedSignLanguage,
  validateAvatarProfile,
  validateMotion,
} from '../src/validate';

const clone = <T>(x: T): any => JSON.parse(JSON.stringify(x));

describe('motion: 正常系', () => {
  it('サンプル motion が通る', () => {
    expect(validateMotion(motionSample).ok).toBe(true);
  });
  it('サンプルは可動域内(VRM profile)', () => {
    const m = validateMotion(motionSample);
    const p = validateAvatarProfile(profileSample);
    if (!m.ok || !p.ok) throw new Error('invalid sample');
    expect(checkRangeOfMotion(m.value, p.value)).toEqual([]);
  });
  it('サンプルは未監修の手話風身振りで、手話扱いされない', () => {
    const m = validateMotion(motionSample);
    if (!m.ok) throw new Error('invalid sample');
    expect(m.value.category).toBe('sign-like-gesture');
    expect(m.value.provenance.status).toBe('unreviewed');
    expect(isReviewedSignLanguage(m.value)).toBe(false);
  });
  it('JSL かつ監修済みのときだけ手話扱い', () => {
    const d = clone(motionSample);
    d.category = 'jsl';
    d.provenance = { status: 'reviewed', reviewer: 'native signer', reviewedAt: '2026-10-28' };
    const m = validateMotion(d);
    if (!m.ok) throw new Error(m.errors.join());
    expect(isReviewedSignLanguage(m.value)).toBe(true);
  });
});

describe('motion: 異常系', () => {
  it('関節数が足りない(指関節1つ欠落)', () => {
    const d = clone(motionSample);
    delete d.keyframes[0].pose.right.joints.indexPip;
    expect(validateMotion(d).ok).toBe(false);
  });
  it('未知の関節が混ざる(関節数超過)', () => {
    const d = clone(motionSample);
    d.keyframes[0].pose.right.joints.pinkyTip = [0, 0, 0];
    expect(validateMotion(d).ok).toBe(false);
  });
  it('左右キーが不正', () => {
    const d = clone(motionSample);
    d.keyframes[0].pose.middle = d.keyframes[0].pose.right;
    expect(validateMotion(d).ok).toBe(false);
  });
  it('左右どちらも無い pose', () => {
    const d = clone(motionSample);
    d.keyframes[0].pose = {};
    expect(validateMotion(d).ok).toBe(false);
  });
  it('timing: 時刻が昇順でない', () => {
    const d = clone(motionSample);
    d.keyframes[1].time = 0;
    const r = validateMotion(d);
    expect(r.ok).toBe(false);
  });
  it('timing: hold が duration を超える', () => {
    const d = clone(motionSample);
    d.keyframes[2].hold = 5;
    expect(validateMotion(d).ok).toBe(false);
  });
  it('timing: 負の時刻 / 不正な ease', () => {
    const a = clone(motionSample);
    a.keyframes[0].time = -1;
    expect(validateMotion(a).ok).toBe(false);
    const b = clone(motionSample);
    b.keyframes[0].ease = 'bounce';
    expect(validateMotion(b).ok).toBe(false);
  });
  it('言語区分が不正', () => {
    const d = clone(motionSample);
    d.category = 'sign-language-translation';
    expect(validateMotion(d).ok).toBe(false);
  });
  it('監修済みなのに監修者が無い', () => {
    const d = clone(motionSample);
    d.provenance = { status: 'reviewed' };
    expect(validateMotion(d).ok).toBe(false);
  });
  it('可動域超過を検出する', () => {
    const d = clone(motionSample);
    d.keyframes[0].pose.right.joints.indexPip = [170, 0, 0];
    const m = validateMotion(d);
    const p = validateAvatarProfile(profileSample);
    if (!m.ok || !p.ok) throw new Error('should be schema-valid');
    expect(checkRangeOfMotion(m.value, p.value).length).toBeGreaterThan(0);
  });
});

describe('avatar profile', () => {
  it('サンプルが通る', () => {
    expect(validateAvatarProfile(profileSample).ok).toBe(true);
  });
  it('full なのに指ボーンが不足すると落ちる', () => {
    const d = clone(profileSample);
    delete d.bones.left.fingers.thumbCmc;
    expect(validateAvatarProfile(d).ok).toBe(false);
  });
  it('gesture-only なら指ボーン無しでも通る(フォールバック)', () => {
    const d = clone(profileSample);
    d.capability = 'gesture-only';
    delete d.bones.left.fingers;
    delete d.bones.right.fingers;
    expect(validateAvatarProfile(d).ok).toBe(true);
  });
  it('左右の手首ボーンが無いと落ちる', () => {
    const d = clone(profileSample);
    delete d.bones.right.wrist;
    expect(validateAvatarProfile(d).ok).toBe(false);
    const e = clone(profileSample);
    delete e.bones.left;
    expect(validateAvatarProfile(e).ok).toBe(false);
  });
  it('可動域の min > max は落ちる', () => {
    const d = clone(profileSample);
    d.rangeOfMotion.indexPip.x = [100, 0];
    expect(validateAvatarProfile(d).ok).toBe(false);
  });
  it('未知の関節名の可動域は落ちる', () => {
    const d = clone(profileSample);
    d.rangeOfMotion.tail = { x: [0, 1] };
    expect(validateAvatarProfile(d).ok).toBe(false);
  });
});

describe('レビュー指摘の追加ケース', () => {
  const okMotion = (d: unknown) => {
    const r = validateMotion(d);
    if (!r.ok) throw new Error(r.errors.join());
    return r.value;
  };
  const okProfile = () => {
    const r = validateAvatarProfile(profileSample);
    if (!r.ok) throw new Error('invalid sample');
    return r.value;
  };

  it('timing 境界: time 0.1 + hold 1.1 = duration 1.2 は通る(浮動小数誤差)', () => {
    const d = clone(motionSample);
    d.duration = 1.2;
    d.keyframes = [{ ...d.keyframes[0], time: 0.1, hold: 1.1 }];
    expect(validateMotion(d).ok).toBe(true);
  });
  it('timing 境界: 実際に超過すれば落ちる', () => {
    const d = clone(motionSample);
    d.duration = 1.2;
    d.keyframes = [{ ...d.keyframes[0], time: 0.1, hold: 1.2 }];
    expect(validateMotion(d).ok).toBe(false);
  });
  it('full の profile で右手の指ボーンが欠けると落ちる', () => {
    const d = clone(profileSample);
    delete d.bones.right.fingers.littleDip;
    expect(validateAvatarProfile(d).ok).toBe(false);
    const e = clone(profileSample);
    delete e.bones.right.fingers;
    expect(validateAvatarProfile(e).ok).toBe(false);
  });
  it('左手の可動域超過を検出する', () => {
    const d = clone(motionSample);
    d.keyframes[0].pose.left.joints.middlePip = [170, 0, 0];
    expect(checkRangeOfMotion(okMotion(d), okProfile()).some((e) => e.includes('/left/middlePip/x'))).toBe(true);
  });
  it('手首の可動域超過を検出する', () => {
    const d = clone(motionSample);
    d.keyframes[0].pose.right.wrist.rotation = [120, 0, 0];
    expect(checkRangeOfMotion(okMotion(d), okProfile()).some((e) => e.includes('/right/wrist/x'))).toBe(true);
  });
  it('reviewer はあるが reviewedAt が無い provenance は落ちる', () => {
    const d = clone(motionSample);
    d.provenance = { status: 'reviewed', reviewer: 'native signer' };
    expect(validateMotion(d).ok).toBe(false);
  });
  it('reviewedAt が不正な日付(2026-13-99)は落ちる', () => {
    const d = clone(motionSample);
    d.provenance = { status: 'reviewed', reviewer: 'x', reviewedAt: '2026-13-99' };
    expect(validateMotion(d).ok).toBe(false);
    d.provenance.reviewedAt = '2026-02-30';
    expect(validateMotion(d).ok).toBe(false);
  });
  it('vec3 が長さ2なら落ちる(回転・位置とも)', () => {
    const a = clone(motionSample);
    a.keyframes[0].pose.right.joints.indexMcp = [0, 0];
    expect(validateMotion(a).ok).toBe(false);
    const b = clone(motionSample);
    b.keyframes[0].pose.right.wrist.position = [0, 0];
    expect(validateMotion(b).ok).toBe(false);
  });
  it('位置は±10m を超えると落ちる(回転用±360の流用ではない)', () => {
    const d = clone(motionSample);
    d.keyframes[0].pose.right.wrist.position = [100, 0, 0];
    expect(validateMotion(d).ok).toBe(false);
  });
  it('hold が負なら落ちる', () => {
    const d = clone(motionSample);
    d.keyframes[0].hold = -1;
    expect(validateMotion(d).ok).toBe(false);
  });
  it('可動域の下限割れを検出する(thumbIp.x は [0,100])', () => {
    const d = clone(motionSample);
    d.keyframes[0].pose.right.joints.thumbIp = [-5, 0, 0];
    expect(checkRangeOfMotion(okMotion(d), okProfile()).some((e) => e.includes('/right/thumbIp/x'))).toBe(true);
  });
  it('arm.shoulder / arm.elbow の範囲外を検出する', () => {
    const d = clone(motionSample);
    d.keyframes[0].pose.right.arm = { shoulder: [120, 0, 0], elbow: [200, 0, 0] };
    const errs = checkRangeOfMotion(okMotion(d), okProfile());
    expect(errs.some((e) => e.includes('/right/shoulder/x'))).toBe(true);
    expect(errs.some((e) => e.includes('/right/elbow/x'))).toBe(true);
  });
  it('vec3 が長さ4なら落ちる', () => {
    const d = clone(motionSample);
    d.keyframes[0].pose.right.joints.indexMcp = [0, 0, 0, 0];
    expect(validateMotion(d).ok).toBe(false);
  });
});
