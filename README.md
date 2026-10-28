# hand-emotion

言葉（テキスト・歌詞・台詞）から、指文字・身振りの両手3Dモーションを生成し、任意の3Dアバターへ流し込むためのモーション基盤ライブラリ。

「手話通訳」「手話翻訳」ではない。UI 上のモード名は「指文字/身振り支援」等とし、手話として扱うのは監修済み（ネイティブ手話話者が確認した）モーションだけ。詳細は `docs/spec.md`、構成は `docs/architecture.md`。

## 現状（Phase 2）

- Phase 0: scaffold、motion / avatar profile の JSON Schema、定義型/再生状態型の分離、ajv 検証器。
- Phase 1: 5語彙（ありがとう/こんにちは/好き/食べる/歌う）のプリセット（すべて未監修・手話風身振り）、keyframe 補間・ease・hold、テキスト→プリセット列（未知語は無動作で字幕のみ）、retarget 純粋関数（可動域 clamp・左手鏡像・gesture-only フォールバック）、簡易両手モデルの再生UI。
- Phase 2: SRT / WebVTT / LRC / プレーンテキストの取り込み（不正は行番号つきエラー）、字幕時刻に同期する再生（身振りが区間に収まらないときは速度を最大1.5倍まで上げ、超過分は省略して字幕のみ）、3モード（字幕ワイプ / 指文字ワイプ〔あいうえおのみ・未監修〕/ アバターリターゲット）。仕様は `docs/spec.md`。
- `npm run dev` で、字幕/歌詞を貼り付けるかファイルを選ぶと、字幕時刻に合わせて手が動く。アバターリターゲットモードでは同じ motion が2種類の骨格（VRM と異名ボーンの別骨格 / gesture-only）に並べて流し込まれる。
- 未実装: 腕位置の可動域補正、顔、実アバター（VRM/glTF モデル）への適用。

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
