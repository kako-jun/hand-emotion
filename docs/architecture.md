# architecture

仕様（データモデル・モードの線引き・retarget 指示形式・MVP）は `docs/spec.md` を参照。ここはコード構成・レイヤ分離・技術スタック。

見た目の設計システム（DESIGN.md）はデモ/プレイグラウンドUI 着手時に起こす（現時点では未作成）。

## スタック

- **Three.js**（両手・指の3D表示、アバター骨格へのリターゲット）。バンドラは **Vite + TypeScript**、テストは **Vitest**、スキーマ検証は **ajv**（JSON Schema 2020-12）、YAML は **yaml**。UI フレームワークは未採用（素の DOM）。
- 独自の手話辞書・アバター資産を抱え込まず、**アバター非依存の中間表現（motion JSON）と avatar profile を介したマッピング**を中心にする。
- VRM 1.0 は `@pixiv/three-vrm` で読み込む（Phase 4a）。手の録画は `@mediapipe/tasks-vision`（Apache-2.0、Phase 4b）。将来: HamNoSys / SiGML import、VRM 以外の glTF humanoid rig への retarget。

## レイヤ分離

3つの層に分け、定義（不変）と実行時 motion（可変）を分ける。

```
motion 生成層        # 入力（テキスト/歌詞/台詞）→ プリセット列 → 中間表現 motion を組み立てる
avatar retarget 層   # 中間表現 motion + avatar profile → 対象アバターの骨格ポーズへマッピング（純粋関数）
Three.js プレビュー層 # 簡易手モデル/アバターへ motion を適用して描画する
```

- **定義データ（不変）**: プリセット motion（`skeleton`/`pose`/`motion`/`timing`/`semantic label`）と avatar profile（どのボーンが肩/肘/手首/指か・可動域・初期姿勢補正）。署名や外部取得ではなく、ライブラリが配る静的定義。
- **実行時 motion/再生状態（可変）**: タイムライン上の再生位置・現在の適用ポーズ・fallback 判定結果。定義側に再生状態を焼き込まない。
- **retarget は純粋なマッピングにする**: 「中間表現 motion + avatar profile → アバター骨格のポーズ列」を、Three.js のシーン/DOM に依存しない純粋関数として実装し、単体テスト可能にする。可動域超過時の腕位置補正・指ボーン不足時の gesture-only フォールバックも、この純粋関数の中で決める。
- **プレビュー層は retarget の結果を描画するだけ**にし、マッピングのロジックを描画コードへ埋め込まない。VRM では座標・回転の変換（`src/avatar/vrmPose.ts`）を DOM/シーン非依存の純粋関数に置き、適用層（`src/preview/vrmAvatar.ts`）は結果を normalized humanoid ボーンへ書くだけ。
- **取り込み・語彙変換・キュータイムラインも Three.js / DOM 非依存の純粋関数**。UI（`main.ts`）は `planFromText` の結果を表示し、`sampleCueTimeline` の姿勢を retarget → 描画へ渡すだけ。モードごとの分岐は `Mode` union の網羅 switch に閉じる。

## 出力形式

- **機械可読 JSON**: runtime が直接読む motion データ。
- **人間/エージェント可読 YAML/Markdown**: エージェントへの retarget 指示書（必須/任意ボーン・フォールバック・優先順位）。

両出力は同一の中間表現から生成する（片方だけが持つ情報を作らない）。実装は Phase 3 の `src/export/`: 共通の brief model（`buildBrief`）を作り、そこから runtime JSON / YAML / Markdown を生成する（Three.js・DOM 非依存の純粋関数。UI は表示・コピー・Blob ダウンロードだけ）。仕様は `docs/spec.md`「出力層」。

## コード構成（Phase 0〜4b）

```
schema/motion.schema.json          # motion の JSON Schema（正本）
schema/avatar-profile.schema.json  # avatar profile の JSON Schema（正本）
samples/                           # 検証を通るサンプル（motion / VRM 用 profile）
src/types/definition.ts            # 不変の定義型（readonly）。MotionDefinition / AvatarProfile
src/types/playback.ts              # 可変の再生状態型。定義への参照のみ持ち、書き戻さない
src/validate/index.ts              # ajv(+ajv-formats) 検証 + スキーマで書けない整合性（timing 昇順・可動域 min<=max）
presets/*.motion.json              # Phase 1 の語彙プリセット(こんにちは/好き/食べる/歌う。ありがとうは samples/ を共用)
samples/{gltf-custom,gesture-only}.avatar-profile.json  # 別骨格デモ用 profile
src/motion/interpolate.ts          # ease・hold・keyframe 補間(純粋関数)。rest.ts は待機姿勢
src/motion/timeline.ts             # 語彙列 → タイムライン、時刻 t の姿勢(語間は 0.4s 遷移)
src/retarget/index.ts              # retargetPose / retargetMotion(純粋関数。可動域 clamp・左手鏡像・gesture-only・初期姿勢補正)
src/text/{presets,vocabulary}.ts   # プリセット読み込み(検証つき)・テキスト → 語彙列(最長一致・未知語は unknown)
src/import/cues.ts                 # SRT/VTT/LRC/プレーン → Cue{start,end,text} 列(純粋関数。不正は行番号つきエラー)
src/motion/cueTimeline.ts          # キュー列 + 語彙変換 → 字幕時刻に同期するタイムライン(速度上限・省略・待機。純粋関数)
src/modes/index.ts                 # Mode(判別可能 union: caption-wipe / fingerspelling-wipe / avatar-retarget)・テキスト → 再生計画 planFromText(純粋関数)
presets/kana-*.motion.json         # かな指文字の最小セット(あいうえお。unreviewed)。src/text/presets.ts の FINGERSPELLING_MOTIONS
src/export/{brief,runtime,yaml,markdown,index}.ts # 出力層。brief model(buildBrief)→ runtime JSON / YAML(yaml パッケージ) / Markdown。往復検証用 validateRuntimeMotion
src/ui/labels.ts                   # UI 文言(モード名/説明・形式名・出力形式名・未監修バッジ)
src/preview/handModel.ts           # Three.js 簡易手モデル。retarget 結果(ボーン名→回転)を適用するだけ
src/avatar/glb.ts                  # .vrm(GLB)のヘッダ検査: VRM 1.0 判定・humanoid ボーン名。VRM 0.x / 非 VRM / 欠落は行つきエラー(純粋関数)
src/avatar/vrmProfile.ts           # humanoid ボーン名 -> avatar profile(full / gesture-only 判定。samples/vrm1-humanoid の対応表を再利用。純粋関数)
src/avatar/vrmPose.ts              # retarget の出力 -> VRM ボーンのローカル quaternion(座標・euler 規約・腕 2 ボーン IK。Three.js の数学クラスのみ・DOM/シーン非依存)
src/preview/vrmAvatar.ts           # three-vrm で .vrm を読み、vrmPose の結果を normalized humanoid へ書くだけ(動的 import で遅延ロード)
scripts/make-fixture-vrm.mjs       # テスト用 VRM 1.0(棒人間)の生成(--check で書き出し済みと一致検査)。fixtures/ に全指あり・指なしの 2 本
tests/vrm.test.ts, tests/vrm-fixture.ts # profile 生成・euler/鏡像規約・IK 到達・手のひら向き・指なし・エラー系(フィクスチャを Object3D 階層にして world 座標で検証)
src/capture/{types,math,hand,series,motion,errors}.ts # 録画の純粋関数(Three.js・MediaPipe・DOM 非依存)。hand: 21 ランドマーク -> HandPose(左右・位置・手首 euler・指の屈曲・腕長スケール)、series: 外れ値・欠落補間・平滑・間引き、motion: フレーム列 -> MotionDefinition(unreviewed 固定)と可動域警告、errors: カメラ/モデルのエラー分類
src/capture/{camera,mediapipe}.ts  # 薄いアダプタ(getUserMedia / HandLandmarker)。ランドマークの意味づけはここに置かない。mediapipe は動的 import
src/ui/recorder.ts                 # 「録画」セクションの DOM コントローラ。純粋関数とアダプタを呼んで表示するだけ
tests/capture.test.ts, tests/capture-synth.ts # 純粋関数の単体テスト。synth は姿勢 -> 合成ランドマーク(順運動学)で往復一致を見る
vite.config.ts                     # vitest 設定 + mediapipe-wasm プラグイン(wasm を /mediapipe-wasm/ で配信・ビルド出力へ複製)
src/main.ts                        # DOM UI(貼り付け/ファイル入力・形式/モード切替・再生/シーク・現在キューのハイライト・エラー表示・VRM 選択)とプレビュー(リターゲット時のみ2骨格を並置)
tests/validate.test.ts             # 正常系 + 関節数/可動域/左右/timing 不正の異常系
tests/typed-samples.ts             # 型付き(as const satisfies)フィクスチャ: サンプル相当 + reviewed/arm/hold/全 ease/jsl 入り
tests/interpolate.test.ts          # 補間・ease・hold
tests/retarget.test.ts             # 鏡像・可動域・gesture-only・初期姿勢補正
tests/vocabulary.test.ts           # プリセット・語彙変換・タイムライン・UI 文言(禁止語走査)
tests/cues.test.ts                 # 各パーサの正常/異常/境界(BOM・CRLF・LRC offset/複数時刻・VTT NOTE/設定・不正時刻の行番号)
tests/cueTimeline.test.ts          # キュー接続(速度上限・省略・待機・同期)・指文字・モード判別・planFromText
tests/export.test.ts               # brief model 各要素・3出力の同一源泉(往復)・runtime JSON 検証・未監修/禁止語走査
tests/types.test.ts                # フィクスチャ==サンプル JSON、フィクスチャがスキーマを通ることの確認
```

- 型とスキーマは手書きで二重管理している（スキーマが正本）。ずれの検知は `tests/typed-samples.ts` の型付きフィクスチャ（`as const satisfies`）が前提で、`npm run build` の tsc が型との不一致を、`tests/types.test.ts` がスキーマ検証と JSON サンプルとの一致を見る。**限界: フィクスチャに現れないフィールドの型/スキーマのずれは検知できない**（vitest 単体は型を検査しない。tsc が必要）。生成化は将来検討。
- 関節回転は euler 角（度）`[x,y,z]`。関節キーは手ごとに 15 個（親指 CMC/MCP/IP、他4指 MCP/PIP/DIP）+ 手首。
- avatar profile の `capability` が `full` なら全指ボーン必須、`gesture-only` なら指ボーン無しで通る（フォールバック）。VRM humanoid 対応は `bones` に VRM ボーン名（例: `leftIndexProximal`）を入れる。

## 録画の依存と配信（Phase 4b）

- **wasm は自サイトで配る（node_modules から複製）**。`@mediapipe/tasks-vision` の `exports` が `wasm/` を公開していないため `?url` import が使えない。そこで `vite.config.ts` の小さなプラグインが、開発サーバーでは `/mediapipe-wasm/*` を `node_modules` から配信し、ビルドでは `dist/mediapipe-wasm/` へ出力する（SIMD 版と非 SIMD 版のみ。`_module_` 版は使わないので複製しない）。CDN にしなかった理由は、実行時に外部へ取りに行くものを手の検出モデル 1 つだけにして、wasm の版ずれ（パッケージ版と CDN 版）と第三者 CDN への依存を避けるため。代償は `dist` に wasm 約 28MB が増えること。
- **モデル `hand_landmarker.task` はバンドルしない**。公式 URL から実行時に取得し、失敗はエラー表示（`classifyModelError`）。
- `@mediapipe/tasks-vision` は `createHandDetector` の中で動的 import（録画を開始するまで読まない）。
- 録画 → motion の純粋関数は MediaPipe の型に依存しない（`DetectedHand` / `CaptureFrame` をアダプタが詰め替える）。UI が持つのは「フレームを溜める・スライダー値を渡す・結果を表示する」だけで、左右・座標・間引きの判断は `src/capture/` に閉じる。

## 未確定事項

- UI 層（フレームワーク）の選定。バンドラは Vite に確定。
- 回転表現を euler から quaternion へ変えるか（retarget 実装時に判断。変更するなら schemaVersion を上げる）。
- 型とスキーマの二重管理を、スキーマからの型生成へ置き換えるか。
- 顔（表情・視線）の motion 表現（avatar profile は `bones.face` の受け口のみ。motion 側は未定義）。
- HamNoSys / SiGML import の実装方式（将来 phase）。
- 録画の胸中央原点・奥行きは弱透視の既定値（カメラ画角 60°・胸中央を画像 (0.5,0.8)・距離 0.7m）。キャリブレーション UI は未実装。
- 録画 motion の腕（肩/肘）は取らない（手首位置 + IK で再現）。顔・体も未対応。
