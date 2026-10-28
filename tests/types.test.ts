import { describe, expect, it } from 'vitest';
import motionSample from '../samples/arigatou.motion.json';
import profileSample from '../samples/vrm1-humanoid.avatar-profile.json';
import { typedFullMotion, typedMotion, typedProfile } from './typed-samples';
import { validateAvatarProfile, validateMotion } from '../src/validate';

// 型とスキーマのずれ検知:
//  - typed-samples.ts が型に合わなければ tsc(npm run build)が落ちる
//  - ここで型付きフィクスチャ == サンプル JSON、かつスキーマ検証を通ることを確認する
describe('型・スキーマ・サンプルの整合', () => {
  it('型付き motion がサンプル JSON と一致しスキーマを通る', () => {
    expect(typedMotion).toEqual(motionSample);
    expect(validateMotion(typedMotion).ok).toBe(true);
  });
  it('型付き profile がサンプル JSON と一致しスキーマを通る', () => {
    expect(typedProfile).toEqual(profileSample);
    expect(validateAvatarProfile(typedProfile).ok).toBe(true);
  });
  it('reviewed/arm/hold/全 ease を含む型付き motion がスキーマを通る', () => {
    expect(validateMotion(typedFullMotion).ok).toBe(true);
  });
});
