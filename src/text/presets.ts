// プリセット motion(すべて sign-like-gesture・unreviewed)。読み込み時にスキーマ検証し、不正なら起動を止める。
import arigatou from '../../samples/arigatou.motion.json';
import konnichiwa from '../../presets/konnichiwa.motion.json';
import suki from '../../presets/suki.motion.json';
import taberu from '../../presets/taberu.motion.json';
import utau from '../../presets/utau.motion.json';
import kanaA from '../../presets/kana-a.motion.json';
import kanaI from '../../presets/kana-i.motion.json';
import kanaU from '../../presets/kana-u.motion.json';
import kanaE from '../../presets/kana-e.motion.json';
import kanaO from '../../presets/kana-o.motion.json';
import { validateMotion } from '../validate';
import type { MotionDefinition } from '../types/definition';

function load(data: unknown): MotionDefinition {
  const r = validateMotion(data);
  if (!r.ok) throw new Error(`preset invalid: ${r.errors.join('; ')}`);
  return r.value;
}

export const PRESET_MOTIONS: readonly MotionDefinition[] = [arigatou, konnichiwa, suki, taberu, utau].map(load);

/** かな指文字の最小セット(あいうえお)。category=kana-fingerspelling・unreviewed。正しい指文字として監修済みではない。 */
export const FINGERSPELLING_MOTIONS: readonly MotionDefinition[] = [kanaA, kanaI, kanaU, kanaE, kanaO].map(load);
