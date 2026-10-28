import { readFileSync, readdirSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

/** MediaPipe の wasm(@mediapipe/tasks-vision/wasm)を /mediapipe-wasm/ で配る。
 *  パッケージの exports が wasm ディレクトリを公開していないので、?url import ではなくここで開発サーバー配信とビルド出力へ載せる。
 *  CDN に依存せず、実行時に外部へ取りに行くのはモデルファイル(hand_landmarker.task)だけにするため。 */
function mediapipeWasm(): Plugin {
  const dir = new URL('./node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url);
  const BASE = '/mediapipe-wasm/';
  const type = (f: string): string => (f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
  return {
    name: 'mediapipe-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!url.startsWith(BASE)) return next();
        const f = url.slice(BASE.length);
        if (!/^[\w.-]+$/.test(f)) return next();
        try {
          const body = readFileSync(new URL(f, dir));
          res.setHeader('Content-Type', type(f));
          res.end(body);
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const f of readdirSync(dir).filter((n) => !n.includes('_module_'))) { // module 版は useModule 用で使わない
        this.emitFile({ type: 'asset', fileName: `mediapipe-wasm/${f}`, source: readFileSync(new URL(f, dir)) });
      }
    },
  };
}

export default defineConfig({
  plugins: [mediapipeWasm()],
  test: { include: ['tests/**/*.test.ts'] },
});
