import * as THREE from 'three';
import vrmProfileJson from '../samples/vrm1-humanoid.avatar-profile.json';
import customProfileJson from '../samples/gltf-custom.avatar-profile.json';
import gestureProfileJson from '../samples/gesture-only.avatar-profile.json';
import { validateAvatarProfile } from './validate';
import { sampleCueTimeline } from './motion/cueTimeline';
import { planFromText } from './modes';
import type { Mode, ModeKind, Plan } from './modes';
import { formatIssue } from './import/cues';
import type { CueFormat } from './import/cues';
import { retargetPose } from './retarget';
import { buildBrief, exportRetargetBriefMarkdown, exportRetargetBriefYaml, runtimeMotionToString } from './export';
import { HandRigPair } from './preview/handModel';
import type { VrmAvatar } from './preview/vrmAvatar';
import { EXPORT_LABELS, FORMAT_LABELS, MODE_LABELS, MODE_NAME, UNREVIEWED_BADGE, omittedCaption, provenanceBadge, unsupportedCaption } from './ui/labels';
import type { ExportKind } from './ui/labels';
import type { AvatarProfile } from './types/definition';

function profile(json: unknown): AvatarProfile {
  const r = validateAvatarProfile(json);
  if (!r.ok) throw new Error(`profile invalid: ${r.errors.join('; ')}`);
  return r.value;
}
const PROFILES = { vrm: profile(vrmProfileJson), custom: profile(customProfileJson), gesture: profile(gestureProfileJson) };
const RIG_B_OPTIONS: [keyof typeof PROFILES, string][] = [
  ['custom', 'glTF 別骨格(異名ボーン・狭い可動域)'],
  ['gesture', 'gesture-only(指ボーン無し)'],
];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const stage = $('stage');
$('mode').textContent = MODE_NAME;
$('badge').textContent = UNREVIEWED_BADGE;
$('note').textContent = '語彙: ありがとう / こんにちは / 好き / 食べる / 歌う';
const textEl = $<HTMLTextAreaElement>('text');
textEl.value = `1
00:00:00,500 --> 00:00:03,000
ありがとう こんにちは

2
00:00:03,500 --> 00:00:06,000
好き！ あした 食べる

3
00:00:06,500 --> 00:00:09,000
歌うよ
`;

// --- three.js シーン(描画だけ) ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a22);
const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 20);
camera.position.set(0, 0, 2.2);
const renderer = new THREE.WebGLRenderer({ antialias: true });
stage.appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const light = new THREE.DirectionalLight(0xffffff, 1.1);
light.position.set(1, 2, 3);
scene.add(light);

const RIG_X = 0.6;
/** 読み込み済みの VRM(あれば手プレビューの代わりに表示) */
let avatar: VrmAvatar | null = null;
const rigA = new HandRigPair(PROFILES.vrm, { colors: { left: 0x6fa8dc, right: 0xf6b26b }, fingerScale: 1.4, palmScale: 1.4 });
scene.add(rigA.group);
let rigB: HandRigPair;
function setRigB(key: keyof typeof PROFILES): void {
  if (rigB) scene.remove(rigB.group);
  rigB = new HandRigPair(PROFILES[key], { colors: { left: 0x93c47d, right: 0xe06666 }, fingerScale: key === 'custom' ? 1.9 : 1.4, palmScale: key === 'custom' ? 1.1 : 1.4 });
  rigB.group.position.set(RIG_X, 0, 0);
  rigB.group.visible = modeKind() === 'avatar-retarget' && !avatar;
  scene.add(rigB.group);
  $('labelB').textContent = `${PROFILES[key].id} (${PROFILES[key].capability})`;
}
const select = $<HTMLSelectElement>('rigB');
for (const [k, label] of RIG_B_OPTIONS) select.add(new Option(label, k));
const modeSel = $<HTMLSelectElement>('modeSel');
for (const k of Object.keys(MODE_LABELS) as ModeKind[]) modeSel.add(new Option(MODE_LABELS[k].name, k));
const formatSel = $<HTMLSelectElement>('format');
for (const k of Object.keys(FORMAT_LABELS) as (CueFormat | 'auto')[]) formatSel.add(new Option(FORMAT_LABELS[k], k));
function modeKind(): ModeKind {
  return modeSel.value as ModeKind;
}
function currentMode(): Mode {
  const kind = modeKind();
  return kind === 'avatar-retarget' ? { kind, profileId: PROFILES[select.value as keyof typeof PROFILES].id } : { kind };
}
setRigB('custom');
$('labelA').textContent = `${PROFILES.vrm.id} (${PROFILES.vrm.capability})`;

/** モードごとのプレビュー構成: リターゲットのときだけ2骨格を並べ、他は1つの手を中央に出す */
function layout(): void {
  const retarget = modeKind() === 'avatar-retarget' && !avatar;
  rigA.group.position.set(retarget ? -RIG_X : 0, 0, 0);
  rigA.group.visible = !avatar;
  rigB.group.visible = retarget;
  $('labelB').hidden = !retarget;
  $('rigBRow').hidden = !retarget;
  placeLabels();
}
function placeLabels(): void {
  const w = stage.clientWidth;
  const retarget = modeKind() === 'avatar-retarget' && !avatar;
  const half = RIG_X / (2 * 2.2 * Math.tan((20 * Math.PI) / 180) * camera.aspect);
  $('labelA').style.left = `${w * (retarget ? 0.5 - half : 0.5)}px`;
  $('labelB').style.left = `${w * (0.5 + half)}px`;
}
function resize(): void {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  placeLabels();
}
addEventListener('resize', resize);

// --- 再生状態(可変) ---
let plan: Plan | null = null;
let time = 0;
let playing = false;
const seek = $<HTMLInputElement>('seek');
const playBtn = $<HTMLButtonElement>('play');
const total = (): number => (plan && plan.ok ? plan.timeline.total : 0);

function setPlaying(p: boolean): void {
  playing = p;
  playBtn.textContent = p ? '一時停止' : '再生';
}
const fmtTime = (t: number): string => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(1).padStart(4, '0')}`;
let renderedCue = -2;
function renderCueList(): void {
  const ol = $('cues');
  ol.textContent = '';
  if (plan && plan.ok) {
    for (const c of plan.cues) {
      const li = document.createElement('li');
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = `${fmtTime(c.start)}-${fmtTime(c.end)}`;
      const x = document.createElement('span');
      x.textContent = c.text.replace(/\n/g, ' / ');
      li.append(t, x);
      ol.append(li);
    }
  }
  renderedCue = -2;
}
function replan(): void {
  const mode = currentMode();
  plan = textEl.value.trim() === '' ? null : planFromText(textEl.value, formatSel.value as CueFormat | 'auto', mode);
  const errBox = $('errors');
  errBox.hidden = !(plan && !plan.ok);
  errBox.textContent = plan && !plan.ok ? plan.errors.map(formatIssue).join('\n') : '';
  $('modeDesc').textContent = MODE_LABELS[mode.kind].description;
  layout();
  renderCueList();
  renderExport();
  time = 0;
  setPlaying(false);
}
for (const el of [textEl, formatSel, modeSel]) el.addEventListener(el === textEl ? 'input' : 'change', replan);
select.addEventListener('change', () => {
  setRigB(select.value as keyof typeof PROFILES);
  exportProfileSel.value = select.value;
  renderExport();
});

// --- 出力(brief model から3種を生成。表示・コピー・ダウンロードだけ) ---
const exportKindSel = $<HTMLSelectElement>('exportKind');
for (const k of Object.keys(EXPORT_LABELS) as ExportKind[]) exportKindSel.add(new Option(EXPORT_LABELS[k].name, k));
const exportProfileSel = $<HTMLSelectElement>('exportProfile');
for (const k of Object.keys(PROFILES) as (keyof typeof PROFILES)[]) exportProfileSel.add(new Option(`${PROFILES[k].id} (${PROFILES[k].capability})`, k));
exportProfileSel.value = 'custom';
function exportProfile(): AvatarProfile {
  return exportProfileSel.value === 'loaded' && avatar ? avatar.profile : PROFILES[exportProfileSel.value as keyof typeof PROFILES];
}
let exportText = '';
function renderExport(): void {
  if (!plan || !plan.ok) {
    exportText = '';
  } else {
    const src = buildBrief(plan.timeline, currentMode(), exportProfile());
    const kind = exportKindSel.value as ExportKind;
    exportText = kind === 'runtime-json' ? runtimeMotionToString(src) : kind === 'brief-yaml' ? exportRetargetBriefYaml(src.brief) : exportRetargetBriefMarkdown(src.brief);
  }
  $('exportOut').textContent = exportText || '(有効な入力がありません)';
  ($('exportCopy') as HTMLButtonElement).disabled = ($('exportDownload') as HTMLButtonElement).disabled = !exportText;
}
for (const el of [exportKindSel, exportProfileSel]) el.addEventListener('change', renderExport);
$('exportCopy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(exportText);
    $('exportStatus').textContent = 'コピーしました';
  } catch {
    $('exportStatus').textContent = 'コピーできませんでした(ブラウザの権限)';
  }
});
$('exportDownload').addEventListener('click', () => {
  const l = EXPORT_LABELS[exportKindSel.value as ExportKind];
  const url = URL.createObjectURL(new Blob([exportText], { type: `${l.mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = l.file;
  a.click();
  URL.revokeObjectURL(url);
  $('exportStatus').textContent = `${l.file} をダウンロード`;
});
// --- VRM(ブラウザ内だけで処理。未読込なら従来の手プレビュー) ---
const vrmErrors = $('vrmErrors');
function showVrmErrors(lines: readonly string[]): void {
  vrmErrors.hidden = lines.length === 0;
  vrmErrors.textContent = lines.join('\n');
}
function setAvatarView(): void {
  if (avatar) {
    camera.position.set(0, 1.28, 1.5);
    camera.lookAt(0, 1.22, 0);
  } else {
    camera.position.set(0, 0, 2.2);
    camera.lookAt(0, 0, 0);
  }
  $('vrmClear').hidden = !avatar;
  $('labelA').textContent = avatar ? `${avatar.profile.id} (${avatar.profile.capability})` : `${PROFILES.vrm.id} (${PROFILES.vrm.capability})`;
  $('vrmStatus').textContent = avatar ? `${avatar.name}: ${avatar.profile.capability}${avatar.notes.length ? ' / ' + avatar.notes.join(' / ') : ''}` : '';
  const loaded = exportProfileSel.querySelector('option[value="loaded"]');
  if (avatar && !loaded) exportProfileSel.add(new Option(`${avatar.profile.id} (${avatar.profile.capability}) 読み込んだ VRM`, 'loaded'));
  if (!avatar && loaded) {
    if (exportProfileSel.value === 'loaded') exportProfileSel.value = 'custom';
    loaded.remove();
  }
  layout();
  renderExport();
}
$<HTMLInputElement>('vrmFile').addEventListener('change', async (ev) => {
  const input = ev.target as HTMLInputElement;
  const f = input.files?.[0];
  if (!f) return;
  showVrmErrors([]);
  try {
    const { loadVrm } = await import('./preview/vrmAvatar');
    const r = await loadVrm(await f.arrayBuffer(), f.name);
    if (!r.ok) {
      showVrmErrors(r.errors.map((e, i) => `${i + 1}: ${e}`));
    } else {
      avatar?.dispose();
      avatar = r.avatar;
      scene.add(avatar.scene);
      setAvatarView();
    }
  } catch (e) {
    showVrmErrors([`VRM の読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`]);
  }
  input.value = '';
});
$('vrmClear').addEventListener('click', () => {
  avatar?.dispose();
  avatar = null;
  showVrmErrors([]);
  setAvatarView();
});
$<HTMLInputElement>('file').addEventListener('change', async (ev) => {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  textEl.value = await f.text();
  replan();
});
playBtn.addEventListener('click', () => {
  if (!playing && time >= total()) time = 0;
  setPlaying(!playing);
});
$('stop').addEventListener('click', () => {
  time = 0;
  setPlaying(false);
});
let dragging = false;
seek.addEventListener('pointerdown', () => { dragging = true; });
for (const ev of ['pointerup', 'pointercancel', 'change'] as const) seek.addEventListener(ev, () => { dragging = false; });
seek.addEventListener('input', () => {
  time = (Number(seek.value) / 1000) * total();
});

let lastUnreachable: readonly string[] = [];
let lastCaption = '';
let lastNotes = '';
let lastRetargets: { a: ReturnType<typeof retargetPose>; b: ReturnType<typeof retargetPose> } | null = null;
let lastPhase = 'idle';
let lastCue = -1;
let lastGesture = '';
const EMPTY_TL = { segments: [], total: 0 } as const;
function frame(dt: number): void {
  if (playing) {
    time += dt;
    if (time >= total()) {
      time = total();
      setPlaying(false);
    }
  }
  const tl = plan && plan.ok ? plan.timeline : EMPTY_TL;
  const s = sampleCueTimeline(tl, time);
  const a = retargetPose(s.pose, avatar ? avatar.profile : rigA.profile);
  const b = retargetPose(s.pose, rigB.profile);
  if (avatar) lastUnreachable = avatar.apply(a, dt);
  else rigA.apply(a);
  if (rigB.group.visible) rigB.apply(b);
  lastRetargets = { a, b };
  lastPhase = s.phase;
  lastCue = s.cueIndex;
  const seg = tl.segments[s.cueIndex];
  const gesture = seg?.gestures && s.gestureIndex >= 0 ? seg.gestures.segments[s.gestureIndex] : undefined;
  lastGesture = gesture?.motion ? `${gesture.token}  [${provenanceBadge(gesture.motion)}]` : '';
  const caption = seg ? (seg.cue.text.replace(/\n/g, ' / ') + (lastGesture ? `    ${lastGesture}` : '')) : '';
  if (caption !== lastCaption) {
    $('caption').textContent = caption;
    lastCaption = caption;
  }
  const notes = seg ? [seg.unsupported.length ? unsupportedCaption(seg.unsupported) : '', seg.omitted.length ? omittedCaption(seg.omitted) : ''].filter(Boolean).join(' / ') : '';
  if (notes !== lastNotes) {
    $('notes').textContent = notes;
    lastNotes = notes;
  }
  if (s.cueIndex !== renderedCue) {
    const items = $('cues').children;
    for (let i = 0; i < items.length; i++) items[i].classList.toggle('active', i === s.cueIndex);
    items[s.cueIndex]?.scrollIntoView({ block: 'nearest' });
    renderedCue = s.cueIndex;
  }
  if (!dragging) seek.value = String(tl.total ? Math.round((time / tl.total) * 1000) : 0);
  $('time').textContent = `${time.toFixed(2)} / ${tl.total.toFixed(2)} s`;
  renderer.render(scene, camera);
}
replan();
resize();
let prev = performance.now();
renderer.setAnimationLoop((now) => {
  frame(Math.min(0.1, (now - prev) / 1000));
  prev = now;
});

// 実ブラウザ検証用の読み取り口(状態の観測のみ)
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__handEmotion = {
    state: () => ({
      time,
      playing,
      total: total(),
      phase: lastPhase,
      mode: modeKind(),
      format: plan?.format ?? null,
      errors: plan && !plan.ok ? plan.errors : [],
      cueIndex: lastCue,
      cues: plan && plan.ok ? plan.cues : [],
      cueInfo: plan && plan.ok ? plan.timeline.segments.map((c) => ({ speed: c.speed, omitted: c.omitted, unsupported: c.unsupported, gestures: c.gestures?.segments.map((g) => g.token) ?? [] })) : [],
      gesture: lastGesture,
      caption: lastCaption,
      notes: lastNotes,
      rigBVisible: rigB.group.visible,
      rigA: { profile: rigA.profile.id, fallback: lastRetargets?.a.fallback, clamped: lastRetargets?.a.clamped.length, right: rigA.snapshot('right'), left: rigA.snapshot('left') },
      rigB: { profile: rigB.profile.id, fallback: lastRetargets?.b.fallback, clamped: lastRetargets?.b.clamped.length, right: rigB.snapshot('right'), left: rigB.snapshot('left') },
      vrm: avatar ? { name: avatar.name, profile: avatar.profile.id, capability: avatar.profile.capability, fallback: lastRetargets?.a.fallback, unreachable: lastUnreachable, notes: avatar.notes, left: avatar.snapshot('left'), right: avatar.snapshot('right') } : null,
      vrmErrors: vrmErrors.hidden ? [] : vrmErrors.textContent.split('\n'),
      fingerA: lastRetargets?.a.right.bones['rightIndexProximal'] ?? null,
      fingerB: lastRetargets?.b.right.bones['Index1.R'] ?? null,
    }),
    exportState: () => ({ kind: exportKindSel.value, profile: exportProfileSel.value, text: exportText }),
    seekTo: (t: number) => { time = t; setPlaying(false); },
    play: () => setPlaying(true),
  };
}
