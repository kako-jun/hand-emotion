# hand-emotion

言葉（テキスト・歌詞・台詞）から、指文字・身振りの両手3Dモーションを生成し、任意の3Dアバターへ流し込むためのモーション基盤ライブラリ。

「手話通訳」「手話翻訳」ではない。UI 上のモード名は「指文字/身振り支援」等とし、手話として扱うのは監修済み（ネイティブ手話話者が確認した）モーションだけ。詳細は `docs/spec.md`、構成は `docs/architecture.md`。

## 現状（Phase 0）

- 完了: scaffold（Vite + TypeScript + Three.js + Vitest）、motion / avatar profile の JSON Schema、不変の定義型と可変の再生状態型の分離、ajv 検証器、サンプル JSON、単体テスト。
- `npm run dev` は Three.js で両手のプレースホルダを表示するだけ（モーション再生・retarget は Phase 1）。

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
