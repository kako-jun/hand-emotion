# architecture

仕様（データモデル・モードの線引き・retarget 指示形式・MVP）は `docs/spec.md` を参照。ここはコード構成・レイヤ分離・技術スタック。

見た目の設計システム（DESIGN.md）はデモ/プレイグラウンドUI 着手時に起こす（現時点では未作成）。

## スタック

- **Three.js**（両手・指の3D表示、アバター骨格へのリターゲット）。アプリケーションフレームワーク（バンドラ/UI層）は未確定。
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

## 未確定事項

- アプリケーションフレームワーク（バンドラ・UI層）の選定。
- 中間表現 motion JSON の正式スキーマ（MVP のプリセット定義を通してから確定する）。
- avatar profile のスキーマ（VRM/glTF humanoid の標準ボーン名との対応表を含む）。
- HamNoSys / SiGML import・MediaPipe Hands 連携の実装方式（将来 phase）。
