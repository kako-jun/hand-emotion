# architecture

仕様（データモデル・モードの線引き・retarget 指示形式・MVP）は `docs/spec.md` を参照。ここはコード構成・レイヤ分離・技術スタック。

見た目の設計システム（DESIGN.md）はデモ/プレイグラウンドUI 着手時に起こす（現時点では未作成）。

## スタック

- **Three.js**（両手・指の3D表示、アバター骨格へのリターゲット）。バンドラは **Vite + TypeScript**、テストは **Vitest**、スキーマ検証は **ajv**（JSON Schema 2020-12）。UI フレームワークは未採用（デモ/プレイグラウンドUI 着手時に決める）。
- 独自の手話辞書・アバター資産を抱え込まず、**アバター非依存の中間表現（motion JSON）と avatar profile を介したマッピング**を中心にする。
- 将来: HamNoSys / SiGML import、MediaPipe Hands、VRM / glTF humanoid rig への retarget。

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
- **プレビュー層は retarget の結果を描画するだけ**にし、マッピングのロジックを描画コードへ埋め込まない。

## 出力形式

- **機械可読 JSON**: runtime が直接読む motion データ。
- **人間/エージェント可読 YAML/Markdown**: エージェントへの retarget 指示書（必須/任意ボーン・フォールバック・優先順位）。

両出力は同一の中間表現から生成する（片方だけが持つ情報を作らない）。

## コード構成（Phase 0）

```
schema/motion.schema.json          # motion の JSON Schema（正本）
schema/avatar-profile.schema.json  # avatar profile の JSON Schema（正本）
samples/                           # 検証を通るサンプル（motion / VRM 用 profile）
src/types/definition.ts            # 不変の定義型（readonly）。MotionDefinition / AvatarProfile
src/types/playback.ts              # 可変の再生状態型。定義への参照のみ持ち、書き戻さない
src/validate/index.ts              # ajv(+ajv-formats) 検証 + スキーマで書けない整合性（timing 昇順・可動域 min<=max）
src/main.ts                        # Three.js 両手プレースホルダ表示（Phase 1 で置換）
tests/validate.test.ts             # 正常系 + 関節数/可動域/左右/timing 不正の異常系
```

- 型とスキーマは手書きで二重管理している（スキーマが正本）。ずれは `tests/typed-samples.ts`（型 `satisfies` 付きフィクスチャ。`npm run build` の tsc で型との不一致を検出）と `tests/types.test.ts`（フィクスチャ==サンプル JSON かつスキーマ検証を通る）で検知する。生成化は将来検討。
- 関節回転は euler 角（度）`[x,y,z]`。関節キーは手ごとに 15 個（親指 CMC/MCP/IP、他4指 MCP/PIP/DIP）+ 手首。
- avatar profile の `capability` が `full` なら全指ボーン必須、`gesture-only` なら指ボーン無しで通る（フォールバック）。VRM humanoid 対応は `bones` に VRM ボーン名（例: `leftIndexProximal`）を入れる。

## 未確定事項

- UI 層（フレームワーク）の選定。バンドラは Vite に確定。
- 回転表現を euler から quaternion へ変えるか（retarget 実装時に判断。変更するなら schemaVersion を上げる）。
- 型とスキーマの二重管理を、スキーマからの型生成へ置き換えるか。
- 顔（表情・視線）の motion 表現（avatar profile は `bones.face` の受け口のみ。motion 側は未定義）。
- HamNoSys / SiGML import・MediaPipe Hands 連携の実装方式（将来 phase）。
