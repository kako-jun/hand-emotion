// MediaPipe Hands(@mediapipe/tasks-vision, Apache-2.0)の薄いアダプタ。ランドマークの意味づけ(座標・左右・屈曲角)はここに置かない。
// モデルファイル hand_landmarker.task はバンドルせず、公式の配布 URL から実行時に取得する。wasm は自サイトの /mediapipe-wasm/ から読む(vite.config.ts)。
import type { DetectedHand } from './types';

/** MediaPipe 公式のモデル配布 URL(float16, v1)。Google が配布するモデルで、ライセンスは Apache-2.0 */
export const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
export const WASM_BASE = `${import.meta.env.BASE_URL}mediapipe-wasm`.replace(/\/{2,}/g, '/');

export type HandDetector = Readonly<{
  /** video の現在のフレームを検出(timestampMs は単調増加)。手が無ければ空配列 */
  detect(video: HTMLVideoElement, timestampMs: number): DetectedHand[];
  close(): void;
}>;

export async function createHandDetector(): Promise<HandDetector> {
  const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const landmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL },
    runningMode: 'VIDEO',
    numHands: 2,
  });
  return {
    detect(video, timestampMs) {
      const r = landmarker.detectForVideo(video, timestampMs);
      return r.landmarks.map((lm, i): DetectedHand => {
        const cat = r.handedness[i]?.[0];
        return {
          label: cat?.categoryName === 'Right' ? 'Right' : 'Left',
          score: cat?.score,
          landmarks: lm.map((p) => ({ x: p.x, y: p.y, z: p.z })),
          worldLandmarks: (r.worldLandmarks[i] ?? []).map((p) => ({ x: p.x, y: p.y, z: p.z })),
        };
      });
    },
    close: () => landmarker.close(),
  };
}
