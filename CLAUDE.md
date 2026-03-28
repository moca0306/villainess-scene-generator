# 悪役令嬢シーンジェネレーター

## 概要
YouTube動画用に、悪役令嬢ストーリーのシナリオCSVからシーン画像を自動生成するツール。
ディレクターと共有して運用する前提。

## 技術スタック
- React 19 + TypeScript + Vite
- Google Gemini API（画像生成 + テキスト）
- デプロイ: Vercel（https://villainess-scene-generator.vercel.app）

## 使用モデル
| 用途 | モデル | 理由 |
|------|--------|------|
| 画像生成 | Nano Banana Pro 2 (`gemini-3-pro-image-preview`) | コスト効率。Flashは不使用 |
| シーン選定 | Gemini 3.1 Pro (`gemini-3.1-pro`) | ストーリー全体の文脈理解が必要なため最高性能モデルを使用 |

## 環境変数
- `GEMINI_API_KEY` — Vercelの環境変数で設定（ビルド時にvite.config.tsのdefineで埋め込み）

## アーキテクチャ
```
src/
├── App.tsx                    メインUI・生成フロー制御
├── types.ts                   型定義
├── services/
│   ├── engine.ts              CSV解析・構図自動選択・プロンプト構築（アニメ私塾流）
│   ├── imageGen.ts            Gemini画像生成API
│   └── sceneSelector.ts       AIシーン選定（Gemini 3.1 Pro）
└── components/
    ├── CharacterSetup.tsx     キャラシートアップロード
    ├── PanelList.tsx          シーン一覧・プロンプト編集
    └── ImagePreview.tsx       プレビューモーダル
```

## アニメ私塾PDFについて
- `references/` にPDFあり（作画レイアウトの描き方）
- 構図テクニック（12種類）・感情→構図マッピング・ショットタイプ判定は `engine.ts` に組み込み済み
- シーン選定プロンプトには映像演出のリズム（ショットタイプ連続回避、場面転換全景等）を反映

## コスト表示
- 画像生成コスト + テキストAPI（シーン選定）コストを合算表示
- 1動画あたりの総経費を把握できるようにしている

## 保留事項
- Markdown形式シナリオ対応 → ディレクターのMDフォーマット確認待ち
