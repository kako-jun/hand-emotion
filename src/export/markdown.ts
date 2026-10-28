// retarget 指示書(Markdown)。brief model だけから組み立てる(他の入力を受け取らない)。
import type { BriefModel } from './brief';

/** 字幕由来の文字列は JSON 文字列として埋め込む(改行・引用符は escape、バッククォートは \u0060 にして Markdown 記法を作らせない) */
const q = (x: string): string => JSON.stringify(x).replace(/`/g, '\\u0060');
const list = (xs: readonly string[]): string => (xs.length ? xs.join(', ') : 'なし');

export function exportRetargetBriefMarkdown(b: BriefModel): string {
  const L: string[] = [];
  L.push('# retarget 指示書', '', `> ${b.notice}`, '');
  L.push(`- briefVersion: ${b.briefVersion}`, `- モード: ${b.mode.kind}`, '');
  L.push('## motion 概要', '', `> ${b.quoteNotice}`, '');
  L.push(`- 長さ: ${b.motion.totalSeconds} 秒 / キュー ${b.motion.cues.length} 件`);
  L.push(`- category: ${list(b.motion.categories)}`, `- provenance: ${list(b.motion.provenanceStates)}`, '', '### 語彙', '');
  if (!b.motion.vocabulary.length) L.push('(身振りに変換された語なし)');
  for (const v of b.motion.vocabulary) L.push(`- \`${v.id}\` ${v.label} (${v.category} / ${v.provenance.status} / ${v.duration} 秒)`);
  L.push('', '### キュー列', '');
  if (!b.motion.cues.length) L.push('(キューなし)');
  for (const c of b.motion.cues) {
    const g = c.gestures.map((x) => `${x.token}[\`${x.motionId}\` ${x.start}-${x.end}]`).join(' ');
    L.push(`- #${c.index} ${c.start}-${c.end} 秒 x${c.speed} ${q(c.text)} ${g ? '→ ' + g : '→ 字幕のみ'}`);
  }
  L.push('', '### 字幕のみになる語', '');
  if (!b.motion.captionOnly.length) L.push('なし');
  for (const x of b.motion.captionOnly) L.push(`- cue #${x.cue} ${q(x.token)}: ${x.reason === 'unsupported' ? '語彙にない(未登録)' : '速度上限のため身振りを省略'}`);
  L.push('', '## avatar profile', '');
  L.push(`- id: \`${b.avatar.profileId}\` / rig: ${b.avatar.rig} / capability: ${b.avatar.capability}`);
  L.push(`- 必須ボーンの不足: ${list(b.avatar.missingRequired)}`, `- 任意ボーンの不足: ${list(b.avatar.missingOptional)}`);
  L.push(`- フォールバック: ${b.avatar.fallback.mode}${b.avatar.fallback.reason ? ` (${b.avatar.fallback.reason})` : ''}`, `  - ${b.avatar.fallback.effect}`, '', '### ボーン対応', '');
  L.push('| key | bone | 区分 |', '| --- | --- | --- |');
  for (const x of b.avatar.bones) L.push(`| ${x.key} | ${x.bone ?? '(なし)'} | ${x.required ? '必須' : '任意'} |`);
  L.push('', '## 可動域で丸められる軸', '');
  if (!b.clamped.length) L.push('なし');
  for (const c of b.clamped) L.push(`- \`${c.axis}\` x${c.count} (${c.motionIds.join(', ')})`);
  L.push('', '## 優先順位', '');
  for (const p of b.priorities) L.push(`${p.rank}. ${p.text}`);
  L.push('', '## 規約', '');
  for (const [k, v] of Object.entries(b.conventions)) L.push(`- ${k}: ${v}`);
  return L.join('\n') + '\n';
}
