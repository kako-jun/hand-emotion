import * as THREE from 'three';
import vrmProfileJson from '../samples/vrm1-humanoid.avatar-profile.json';
import customProfileJson from '../samples/gltf-custom.avatar-profile.json';
import gestureProfileJson from '../samples/gesture-only.avatar-profile.json';
import { validateAvatarProfile } from './validate';
import { buildTimeline, sampleTimeline } from './motion/timeline';
import { retargetPose } from './retarget';
import { textToSequence } from './text/vocabulary';
import { HandRigPair } from './preview/handModel';
import { MODE_NAME, UNREVIEWED_BADGE, provenanceBadge, unknownCaption } from './ui/labels';
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
const textEl = $<HTMLInputElement>('text');
textEl.value = 'ありがとう こんにちは 好き 食べる 歌う';

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
const rigA = new HandRigPair(PROFILES.vrm, { colors: { left: 0x6fa8dc, right: 0xf6b26b }, fingerScale: 1.4, palmScale: 1.4 });
rigA.group.position.set(-RIG_X, 0, 0);
scene.add(rigA.group);
let rigB: HandRigPair;
function setRigB(key: keyof typeof PROFILES): void {
  if (rigB) scene.remove(rigB.group);
  rigB = new HandRigPair(PROFILES[key], { colors: { left: 0x93c47d, right: 0xe06666 }, fingerScale: key === 'custom' ? 1.9 : 1.4, palmScale: key === 'custom' ? 1.1 : 1.4 });
  rigB.group.position.set(RIG_X, 0, 0);
  scene.add(rigB.group);
  $('labelB').textContent = `${PROFILES[key].id} (${PROFILES[key].capability})`;
}
const select = $<HTMLSelectElement>('rigB');
for (const [k, label] of RIG_B_OPTIONS) select.add(new Option(label, k));
select.addEventListener('change', () => setRigB(select.value as keyof typeof PROFILES));
setRigB('custom');
$('labelA').textContent = `${PROFILES.vrm.id} (${PROFILES.vrm.capability})`;

function resize(): void {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  $('labelA').style.left = `${w * (0.5 - (RIG_X / (2 * 2.2 * Math.tan((20 * Math.PI) / 180) * camera.aspect)))}px`;
  $('labelB').style.left = `${w * (0.5 + (RIG_X / (2 * 2.2 * Math.tan((20 * Math.PI) / 180) * camera.aspect)))}px`;
}
addEventListener('resize', resize);

// --- 再生状態(可変) ---
let timeline = buildTimeline(textToSequence(textEl.value));
let time = 0;
let playing = false;
const seek = $<HTMLInputElement>('seek');
const playBtn = $<HTMLButtonElement>('play');

function setPlaying(p: boolean): void {
  playing = p;
  playBtn.textContent = p ? '一時停止' : '再生';
}
textEl.addEventListener('input', () => {
  timeline = buildTimeline(textToSequence(textEl.value));
  time = 0;
  setPlaying(false);
});
playBtn.addEventListener('click', () => {
  if (!playing && time >= timeline.total) time = 0;
  setPlaying(!playing);
});
$('stop').addEventListener('click', () => {
  time = 0;
  setPlaying(false);
});
seek.addEventListener('input', () => {
  time = (Number(seek.value) / 1000) * timeline.total;
});

let lastCaption = '';
let lastRetargets: { a: ReturnType<typeof retargetPose>; b: ReturnType<typeof retargetPose> } | null = null;
let lastPhase = 'idle';
let lastIndex = -1;
function frame(dt: number): void {
  if (playing) {
    time += dt;
    if (time >= timeline.total) {
      time = timeline.total;
      setPlaying(false);
    }
  }
  const s = sampleTimeline(timeline, time);
  const a = retargetPose(s.pose, rigA.profile);
  const b = retargetPose(s.pose, rigB.profile);
  rigA.apply(a);
  rigB.apply(b);
  lastRetargets = { a, b };
  lastPhase = s.phase;
  lastIndex = s.segmentIndex;
  const seg = timeline.segments[s.segmentIndex];
  const caption = !seg ? '' : seg.motion ? `${seg.token}  [${provenanceBadge(seg.motion)}]` : unknownCaption(seg.token);
  if (caption !== lastCaption) {
    $('caption').textContent = caption;
    $('caption').className = seg && !seg.motion ? 'unknown' : '';
    lastCaption = caption;
  }
  if (document.activeElement !== seek) seek.value = String(timeline.total ? Math.round((time / timeline.total) * 1000) : 0);
  $('time').textContent = `${time.toFixed(2)} / ${timeline.total.toFixed(2)} s`;
  renderer.render(scene, camera);
}
resize();
let prev = performance.now();
renderer.setAnimationLoop((now) => {
  frame(Math.min(0.1, (now - prev) / 1000));
  prev = now;
});

// 実ブラウザ検証用の読み取り口(状態の観測のみ)
(window as unknown as Record<string, unknown>).__handEmotion = {
  state: () => ({
    time,
    playing,
    total: timeline.total,
    phase: lastPhase,
    segmentIndex: lastIndex,
    caption: lastCaption,
    tokens: timeline.segments.map((s) => ({ token: s.token, motion: s.motion?.id ?? null })),
    rigA: { profile: rigA.profile.id, fallback: lastRetargets?.a.fallback, clamped: lastRetargets?.a.clamped.length, right: rigA.snapshot('right'), left: rigA.snapshot('left') },
    rigB: { profile: rigB.profile.id, fallback: lastRetargets?.b.fallback, clamped: lastRetargets?.b.clamped.length, right: rigB.snapshot('right'), left: rigB.snapshot('left') },
    fingerA: lastRetargets?.a.right.bones['rightIndexProximal'] ?? null,
    fingerB: lastRetargets?.b.right.bones['Index1.R'] ?? null,
  }),
  seekTo: (t: number) => { time = t; setPlaying(false); },
};
