// プリセット motion(すべて sign-like-gesture・unreviewed)。読み込み時にスキーマ検証し、不正なら起動を止める。
import arigatou from '../../samples/arigatou.motion.json';
import konnichiwa from '../../presets/konnichiwa.motion.json';
import suki from '../../presets/suki.motion.json';
import taberu from '../../presets/taberu.motion.json';
import utau from '../../presets/utau.motion.json';
import { validateMotion } from '../validate';
import type { MotionDefinition } from '../types/definition';

function load(data: unknown): MotionDefinition {
  const r = validateMotion(data);
  if (!r.ok) throw new Error(`preset invalid: ${r.errors.join('; ')}`);
  return r.value;
}

export const PRESET_MOTIONS: readonly MotionDefinition[] = [arigatou, konnichiwa, suki, taberu, utau].map(load);
