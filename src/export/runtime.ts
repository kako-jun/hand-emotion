// runtime が直接読む JSON。brief model をそのまま含み(同一源泉)、使われた motion 定義を同梱する。
import { validateMotion } from '../validate';
import type { MotionDefinition } from '../types/definition';
import { BRIEF_VERSION } from './brief';
import type { BriefModel, BriefSource } from './brief';

export const RUNTIME_FORMAT = 'hand-emotion.runtime-motion';
export const RUNTIME_VERSION = '0.1.0';

export type RuntimeMotionJson = Readonly<{
  format: typeof RUNTIME_FORMAT;
  version: string;
  brief: BriefModel;
  motions: readonly MotionDefinition[];
}>;

export function exportRuntimeMotion(src: BriefSource): RuntimeMotionJson {
  return { format: RUNTIME_FORMAT, version: RUNTIME_VERSION, brief: src.brief, motions: src.motions };
}

export const runtimeMotionToString = (src: BriefSource): string => JSON.stringify(exportRuntimeMotion(src), null, 2) + '\n';

/** runtime JSON の検証: 形式/版、同梱 motion が既存検証器を通ること、キューの参照整合。 */
export function validateRuntimeMotion(data: unknown): { ok: true; value: RuntimeMotionJson } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const d = data as Partial<RuntimeMotionJson> | null;
  if (!d || typeof d !== 'object') return { ok: false, errors: ['/ must be an object'] };
  if (d.format !== RUNTIME_FORMAT) errors.push('/format must be ' + RUNTIME_FORMAT);
  if (d.version !== RUNTIME_VERSION) errors.push('/version must be ' + RUNTIME_VERSION);
  if (!d.brief || typeof d.brief !== 'object') errors.push('/brief missing');
  else if (d.brief.briefVersion !== BRIEF_VERSION) errors.push('/brief/briefVersion must be ' + BRIEF_VERSION);
  if (!Array.isArray(d.motions)) errors.push('/motions must be an array');
  if (errors.length) return { ok: false, errors };
  const ids = new Set<string>();
  d.motions!.forEach((m, i) => {
    const r = validateMotion(m);
    if (!r.ok) errors.push(...r.errors.map((e) => `/motions/${i}${e}`));
    else ids.add(r.value.id);
  });
  for (const c of d.brief!.motion?.cues ?? []) {
    for (const g of c.gestures) if (!ids.has(g.motionId)) errors.push(`/brief/motion/cues/${c.index} references unknown motion ${g.motionId}`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: d as RuntimeMotionJson };
}
