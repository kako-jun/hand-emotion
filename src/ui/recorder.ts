// 「録画」セクションの DOM コントローラ。ロジックは持たず、純粋関数(src/capture)とアダプタ(camera / mediapipe)を呼んで表示するだけ。
import { openCamera, stopCamera } from '../capture/camera';
import { classifyCameraError, classifyModelError } from '../capture/errors';
import type { CaptureErrorKind } from '../capture/errors';
import { resolveSide } from '../capture/hand';
import { buildRecordedMotion } from '../capture/motion';
import type { HandDetector } from '../capture/mediapipe';
import { DEFAULT_SETTINGS } from '../capture/types';
import type { CaptureFrame } from '../capture/types';
import type { AvatarProfile, MotionDefinition } from '../types/definition';
import { CAPTURE_ERROR_LABELS, REC_MODEL_NOTE, REC_NOTICE, REC_STATUS, REC_TITLE, REC_VOCAB_NOTE, UNREVIEWED_BADGE, captureWarningLine, detectionLabel } from './labels';

/** 録画の上限(秒)。メモリを使い続けないため */
export const MAX_RECORD_SECONDS = 60;

export type RecorderHost = Readonly<{
  profile: AvatarProfile;
  /** 再生確認: motion を手プレビュー/VRM に流す(null で止める)。onEnd は再生が最後まで進んだとき */
  setAudition(motion: MotionDefinition | null, onEnd?: () => void): void;
  addVocab(motion: MotionDefinition): void;
  removeVocab(id: string): void;
}>;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export function createRecorder(host: RecorderHost, loadDetector: () => Promise<HandDetector>) {
  const el = {
    title: $('recTitle'), notice: $('recNotice'), camera: $<HTMLButtonElement>('recCamera'), cameraStop: $<HTMLButtonElement>('recCameraStop'),
    start: $<HTMLButtonElement>('recStart'), stop: $<HTMLButtonElement>('recStop'), status: $('recStatus'), badge: $('recBadge'),
    video: $<HTMLVideoElement>('recVideo'), detect: $('recDetect'), errors: $('recErrors'), edit: $('recEdit'),
    trimStart: $<HTMLInputElement>('recTrimStart'), trimEnd: $<HTMLInputElement>('recTrimEnd'), trimText: $('recTrimText'),
    label: $<HTMLInputElement>('recLabel'), arm: $<HTMLInputElement>('recArm'), audition: $<HTMLButtonElement>('recAudition'),
    add: $<HTMLButtonElement>('recAdd'), download: $<HTMLButtonElement>('recDownload'), problems: $('recProblems'), info: $('recInfo'),
    warn: $('recWarn'), vocab: $('recVocab'),
  };
  el.title.textContent = REC_TITLE;
  el.notice.textContent = `${REC_NOTICE} ${REC_MODEL_NOTE} ${REC_VOCAB_NOTE}`;
  el.badge.textContent = UNREVIEWED_BADGE;

  let stream: MediaStream | null = null;
  let detector: HandDetector | null = null;
  let raf = 0;
  let lastVideoTime = -1;
  let recording = false;
  let recStart = 0;
  let frames: CaptureFrame[] = [];
  let aspect = DEFAULT_SETTINGS.aspect;
  let recId = '';
  let current: MotionDefinition | null = null;
  const added = new Map<string, string>(); // id -> label
  let auditioning = false;

  const setStatus = (s: string): void => { el.status.textContent = s; };
  function showError(kind: CaptureErrorKind, detail?: string): void {
    el.errors.hidden = false;
    el.errors.textContent = CAPTURE_ERROR_LABELS[kind] + (detail && kind !== 'denied' && kind !== 'no-device' ? `\n(${detail})` : '');
  }
  const clearError = (): void => { el.errors.hidden = true; el.errors.textContent = ''; };

  function teardown(): void {
    cancelAnimationFrame(raf);
    recording = false;
    stopCamera(stream);
    stream = null;
    detector?.close();
    detector = null;
    el.video.srcObject = null;
    el.video.hidden = true;
    el.camera.hidden = false;
    el.camera.disabled = false;
    el.cameraStop.hidden = true;
    el.start.disabled = true;
    el.stop.disabled = true;
    el.detect.textContent = '';
  }

  async function startCamera(): Promise<void> {
    clearError();
    el.camera.disabled = true;
    setStatus(REC_STATUS.loading);
    try {
      stream = await openCamera();
    } catch (e) {
      teardown();
      setStatus(REC_STATUS.idle);
      showError(classifyCameraError(e), e instanceof Error ? e.message : undefined);
      return;
    }
    el.video.srcObject = stream;
    el.video.hidden = false;
    try {
      await el.video.play();
    } catch (e) {
      teardown();
      setStatus(REC_STATUS.idle);
      showError(classifyCameraError(e), e instanceof Error ? e.message : undefined);
      return;
    }
    try {
      detector = await loadDetector();
    } catch (e) {
      teardown();
      setStatus(REC_STATUS.idle);
      showError(classifyModelError(e), e instanceof Error ? e.message : undefined);
      return;
    }
    el.camera.hidden = true;
    el.cameraStop.hidden = false;
    el.start.disabled = false;
    setStatus(REC_STATUS.ready);
    loop();
  }

  function loop(): void {
    raf = requestAnimationFrame(loop);
    if (!detector || el.video.readyState < 2 || el.video.currentTime === lastVideoTime) return;
    lastVideoTime = el.video.currentTime;
    const now = performance.now();
    let hands;
    try {
      hands = detector.detect(el.video, now);
    } catch (e) {
      teardown();
      setStatus(REC_STATUS.idle);
      showError('unknown', e instanceof Error ? e.message : undefined);
      return;
    }
    const sides = [...new Set(hands.map((h) => resolveSide(h.label, DEFAULT_SETTINGS.mirroredInput)))];
    el.detect.textContent = detectionLabel(sides);
    el.detect.classList.toggle('none', sides.length === 0);
    if (recording) {
      const t = (now - recStart) / 1000;
      frames.push({ time: t, hands });
      if (t >= MAX_RECORD_SECONDS) stopRecording();
    }
  }

  function startRecording(): void {
    host.setAudition(null);
    auditioning = false;
    frames = [];
    recording = true;
    recStart = performance.now();
    aspect = el.video.videoWidth && el.video.videoHeight ? el.video.videoWidth / el.video.videoHeight : DEFAULT_SETTINGS.aspect;
    el.start.disabled = true;
    el.stop.disabled = false;
    el.edit.hidden = true;
    setStatus(REC_STATUS.recording);
  }

  function stopRecording(): void {
    recording = false;
    el.start.disabled = !stream;
    el.stop.disabled = true;
    if (frames.length < 2) {
      setStatus(REC_STATUS.noFrames);
      return;
    }
    setStatus(REC_STATUS.stopped);
    openEditor(frames, aspect);
  }

  // --- 編集 ---
  const span = (): number => frames.length ? frames[frames.length - 1].time : 0;
  const trimTimes = (): { start: number; end: number } => {
    const total = span();
    const a = (Number(el.trimStart.value) / 1000) * total;
    const b = (Number(el.trimEnd.value) / 1000) * total;
    return { start: Math.min(a, b), end: Math.max(a, b) };
  };

  function openEditor(f: CaptureFrame[], asp: number): void {
    frames = f;
    aspect = asp;
    recId = `rec-${Date.now().toString(36)}`;
    el.trimStart.value = '0';
    el.trimEnd.value = '1000';
    el.edit.hidden = false;
    rebuild();
  }

  function rebuild(): void {
    host.setAudition(null);
    auditioning = false;
    el.audition.textContent = '再生確認';
    const { start, end } = trimTimes();
    el.trimText.textContent = `${start.toFixed(2)} 〜 ${end.toFixed(2)} 秒 / 録画 ${span().toFixed(2)} 秒`;
    const label = el.label.value.trim();
    const arm = Number(el.arm.value);
    const r = buildRecordedMotion(frames, {
      id: recId,
      label: label || '(未入力)',
      settings: { ...DEFAULT_SETTINGS, aspect, armLength: Number.isFinite(arm) && arm > 0 ? arm : DEFAULT_SETTINGS.armLength },
      trim: end > start ? { start, end } : undefined,
      profile: host.profile,
    });
    el.problems.hidden = r.ok;
    el.problems.textContent = r.ok ? '' : r.errors.join('\n');
    current = r.ok ? r.motion : null;
    el.info.textContent = r.ok ? `${r.stats.keyframes} キーフレーム / ${r.stats.duration.toFixed(2)} 秒(${r.stats.frames} フレームから間引き) — ${UNREVIEWED_BADGE}` : '';
    el.warn.textContent = r.ok ? r.warnings.map(captureWarningLine).join('\n') : '';
    el.audition.disabled = !current;
    el.add.disabled = el.download.disabled = !current || !label;
  }

  function renderVocab(): void {
    el.vocab.textContent = '';
    if (!added.size) return;
    el.vocab.append('語彙に追加済み: ');
    for (const [id, label] of added) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${label} ×`;
      b.title = '語彙から外す';
      b.addEventListener('click', () => {
        added.delete(id);
        host.removeVocab(id);
        renderVocab();
      });
      el.vocab.append(b, ' ');
    }
  }

  el.camera.addEventListener('click', () => { void startCamera(); });
  el.cameraStop.addEventListener('click', () => { teardown(); setStatus(REC_STATUS.idle); });
  el.start.addEventListener('click', startRecording);
  el.stop.addEventListener('click', stopRecording);
  for (const e of [el.trimStart, el.trimEnd, el.label, el.arm]) e.addEventListener('input', rebuild);
  el.audition.addEventListener('click', () => {
    if (auditioning) {
      host.setAudition(null);
      auditioning = false;
      el.audition.textContent = '再生確認';
    } else if (current) {
      auditioning = true;
      el.audition.textContent = '再生を止める';
      host.setAudition(current, () => { auditioning = false; el.audition.textContent = '再生確認'; });
    }
  });
  el.add.addEventListener('click', () => {
    if (!current) return;
    host.addVocab(current);
    added.set(current.id, current.semantic.label);
    renderVocab();
  });
  el.download.addEventListener('click', () => {
    if (!current) return;
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(current, null, 2)}\n`], { type: 'application/json;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${current.id}.motion.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  setStatus(REC_STATUS.idle);

  return {
    /** DEV 検証用: 録画が終わった状態を作る(実カメラ・実検出なしで編集〜語彙追加の導線を通す) */
    inject: (f: CaptureFrame[], asp = DEFAULT_SETTINGS.aspect): void => { el.edit.hidden = false; openEditor(f, asp); },
    state: () => ({ recording, frames: frames.length, current, added: [...added.entries()], status: el.status.textContent, error: el.errors.hidden ? '' : el.errors.textContent, detect: el.detect.textContent, problems: el.problems.textContent, warn: el.warn.textContent, info: el.info.textContent }),
  };
}
