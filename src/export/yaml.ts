// retarget 指示書(YAML)。brief model をそのまま直列化する。
import { parse, stringify } from 'yaml';
import type { BriefModel } from './brief';

export const exportRetargetBriefYaml = (brief: BriefModel): string => stringify(brief, { lineWidth: 0 });
export const parseRetargetBriefYaml = (text: string): unknown => parse(text);
