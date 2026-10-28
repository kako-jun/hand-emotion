import { FINGER_JOINTS } from '../types/definition';
import type { FingerJoint, HandPose, Vec3 } from '../types/definition';

const zero = {} as Record<FingerJoint, Vec3>;
for (const j of FINGER_JOINTS) zero[j] = [0, 0, 0];

/** 待機姿勢(指定のない手)。左は右手規約で書く(鏡像は retarget が掛ける)。胸の横で軽く下ろす。 */
export const REST_POSE: Readonly<{ left: HandPose; right: HandPose }> = {
  left: { wrist: { position: [0.2, -0.4, 0.05], rotation: [0, 0, 0] }, joints: zero },
  right: { wrist: { position: [0.2, -0.4, 0.05], rotation: [0, 0, 0] }, joints: zero },
};
