# hand-emotion

言葉（テキスト・歌詞・台詞）から、指文字・身振りの両手3Dモーションを生成し、任意の3Dアバターへ流し込むためのモーション基盤ライブラリ。

「手話通訳」「手話翻訳」ではない。UI 上のモード名は「指文字/身振り支援」等とし、手話として扱うのは監修済み（ネイティブ手話話者が確認した）モーションだけ。詳細は `docs/spec.md`、構成は `docs/architecture.md`。

## 現状（Phase 4b）

- Phase 0: scaffold、motion / avatar profile の JSON Schema、定義型/再生状態型の分離、ajv 検証器。
- Phase 1: 5語彙（ありがとう/こんにちは/好き/食べる/歌う）のプリセット（すべて未監修・手話風身振り）、keyframe 補間・ease・hold、テキスト→プリセット列（未知語は無動作で字幕のみ）、retarget 純粋関数（可動域 clamp・左手鏡像・gesture-only フォールバック）、簡易両手モデルの再生UI。
- Phase 2: SRT / WebVTT / LRC / プレーンテキストの取り込み（不正は行番号つきエラー）、字幕時刻に同期する再生（身振りが区間に収まらないときは速度を最大1.5倍まで上げ、超過分は省略して字幕のみ）、3モード（字幕ワイプ / 指文字ワイプ〔あいうえおのみ・未監修〕/ アバターリターゲット）。仕様は `docs/spec.md`。
- Phase 3: 共通の brief model から runtime JSON / retarget 指示書（YAML）/ 指示書（Markdown）を同一源泉で出力（欠けたボーンと fallback・丸められる軸・優先順位・規約・未監修の注意文を含む）。画面の「出力」でプレビュー・コピー・ダウンロード。
- `npm run dev` で、字幕/歌詞を貼り付けるかファイルを選ぶと、字幕時刻に合わせて手が動く。アバターリターゲットモードでは同じ motion が2種類の骨格（VRM と異名ボーンの別骨格 / gesture-only）に並べて流し込まれる。
- Phase 4a: 手元の VRM 1.0（`.vrm`）を画面の「VRM(1.0)」から選ぶと、字幕に同期して両手・腕が動く（ファイルはブラウザ内だけで処理しアップロードしない。未読込時は従来の手プレビュー）。humanoid から avatar profile を自動生成し、指ボーンが欠けていれば gesture-only に落ちる。VRM 0.x は未対応。テスト用の棒人間 VRM は `node scripts/make-fixture-vrm.mjs` で `fixtures/` に生成（第三者アバターは同梱しない）。規約は `docs/spec.md`「VRM 1.0 への適用規約」。
- Phase 4b: ウェブカメラの自分の手を MediaPipe Hands で読み、motion JSON にする（画面の「録画」）。録画 → 開始/終了のトリミング → ラベル（語）入力 → 再生確認 → 実行時の語彙へ追加（字幕に当てはまる。自動保存しない）→ JSON ダウンロード。録画 motion は常に `sign-like-gesture`・`unreviewed`（「未監修・手話風身振り」）で、可動域外の関節は clamp せず警告に出す。映像はブラウザ内だけで処理し、保存も送信もしない。規約は `docs/spec.md`「録画（Phase 4b）」。
- 未実装: 腕位置の可動域補正、顔、VRM 以外の glTF モデルへの適用、録画の腕（肩/肘）・顔・体、カメラ位置のキャリブレーション。

## 録画の実カメラ確認（kako-jun 向け）

自動テストで確認できているのは、合成ランドマークでの往復一致・エラー経路・検出なし経路まで。**実際の手の検出は自動化できておらず、実カメラでの確認が必要**（未検証）。

1. `npm run dev` で開き、「録画」を開く。「カメラを開始」を押してカメラを許可（初回は手の検出モデルを Google の配布 URL から取得するので数秒かかる）。
2. 手をカメラに向ける。「検出: 右手」のように出る（画面の鏡像表示で、自分の右手が「右手」と出ること。逆なら左右の決めが実カメラと合っていない）。手を外すと「検出なし」になる。
3. 「録画」→ 手を動かす（指を曲げる、手を左右へ）→「録画を止める」。トリミングのスライダー、ラベル（語）、腕の長さを触り、警告の表示を確認する。
4. 「再生確認」で手プレビュー（または読み込んだ VRM）が録画どおりに動くか見る。自分の右手を動かすと「右」の手が動く（左右が入れ替わっていないこと）。指を曲げると指先が手のひら側へ曲がる。
5. 「語彙に追加」後、字幕に同じ語を入れて再生すると、その語で録画の身振りが出る。「JSON をダウンロード」で `<id>.motion.json` が落ちる。

## 出典・ライセンス

- 手の検出は [MediaPipe Hands / Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)（`@mediapipe/tasks-vision`、Apache-2.0、Google）。
- 手の検出モデル `hand_landmarker.task` はこのリポジトリに含めない。実行時に MediaPipe 公式の配布 URL `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task` から取得する（モデルの条件は MediaPipe のモデルカードに従う）。オフラインでは録画できない。
- wasm（`@mediapipe/tasks-vision` 同梱）は自サイトの `/mediapipe-wasm/` から配信する。
- `@mediapipe/tasks-vision` は利用統計（映像は含まない）を Google へ送る実装だが、`index.html` の CSP（`connect-src`）で遮断している。外部への接続はモデルの取得先（storage.googleapis.com）だけ。

## コマンド

```
npm install
npm run dev     # 開発サーバー
npm run build   # 型チェック + ビルド
npm test        # Vitest（スキーマ検証の正常系/異常系）
```

## スキーマ

- `schema/motion.schema.json` — 言語区分（jsl / kana-fingerspelling / sign-like-gesture）と provenance（未監修/監修済み）を持つ中間表現
- `schema/avatar-profile.schema.json` — 左右手・指ボーン・可動域・初期姿勢補正・VRM humanoid 対応・gesture-only フォールバック
- `samples/` — 検証を通るサンプル
