import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import motionSchema from '../../schema/motion.schema.json';
import profileSchema from '../../schema/avatar-profile.schema.json';
import type { AvatarProfile, AxisRange, MotionDefinition } from '../types/definition';

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTypes: false });
addFormats(ajv);
const EPS = 1e-9;
const validateMotionSchema = ajv.compile(motionSchema);
const validateProfileSchema = ajv.compile(profileSchema);

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

function schemaErrors(v: { errors?: { instancePath: string; message?: string }[] | null }): string[] {
  return (v.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim());
}

function axisValue(rot: readonly number[], axis: 'x' | 'y' | 'z'): number {
  return rot[{ x: 0, y: 1, z: 2 }[axis]];
}

/** スキーマで表現できない timing の整合性 */
function timingErrors(m: MotionDefinition): string[] {
  const errs: string[] = [];
  let prev = -Infinity;
  m.keyframes.forEach((k, i) => {
    if (k.time <= prev + EPS) errs.push(`/keyframes/${i}/time must be strictly increasing`);
    prev = k.time;
    if (k.time + (k.hold ?? 0) > m.duration + EPS) errs.push(`/keyframes/${i} time+hold exceeds duration`);
  });
  return errs;
}

export function validateMotion(data: unknown): ValidationResult<MotionDefinition> {
  if (!validateMotionSchema(data)) return { ok: false, errors: schemaErrors(validateMotionSchema) };
  const m = data as unknown as MotionDefinition;
  const errs = timingErrors(m);
  return errs.length ? { ok: false, errors: errs } : { ok: true, value: m };
}

export function validateAvatarProfile(data: unknown): ValidationResult<AvatarProfile> {
  if (!validateProfileSchema(data)) return { ok: false, errors: schemaErrors(validateProfileSchema) };
  const p = data as unknown as AvatarProfile;
  const errs: string[] = [];
  for (const [joint, r] of Object.entries(p.rangeOfMotion)) {
    if (!r) continue;
    for (const axis of ['x', 'y', 'z'] as const) {
      const range = r[axis];
      if (range && range[0] > range[1]) errs.push(`/rangeOfMotion/${joint}/${axis} min exceeds max`);
    }
  }
  return errs.length ? { ok: false, errors: errs } : { ok: true, value: p };
}

/** motion の各関節回転が avatar profile の可動域に収まるか(収まらない箇所を返す) */
export function checkRangeOfMotion(m: MotionDefinition, p: AvatarProfile): string[] {
  const errs: string[] = [];
  m.keyframes.forEach((k, i) => {
    for (const side of ['left', 'right'] as const) {
      const hp = k.pose[side];
      if (!hp) continue;
      const entries: [string, readonly number[]][] = [
        ['wrist', hp.wrist.rotation],
        ...Object.entries(hp.joints),
      ];
      if (hp.arm?.shoulder) entries.push(['shoulder', hp.arm.shoulder]);
      if (hp.arm?.elbow) entries.push(['elbow', hp.arm.elbow]);
      for (const [joint, rot] of entries) {
        const r = (p.rangeOfMotion as Record<string, AxisRange | undefined>)[joint];
        if (!r) continue;
        for (const axis of ['x', 'y', 'z'] as const) {
          const range = r[axis];
          if (!range) continue;
          const v = axisValue(rot, axis);
          if (v < range[0] || v > range[1]) {
            errs.push(`/keyframes/${i}/pose/${side}/${joint}/${axis}=${v} outside [${range[0]},${range[1]}]`);
          }
        }
      }
    }
  });
  return errs;
}

/** 「手話」として扱ってよいのは、JSL かつ監修済みの motion だけ。 */
export function isReviewedSignLanguage(m: MotionDefinition): boolean {
  return m.category === 'jsl' && m.provenance.status === 'reviewed';
}
