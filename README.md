# Letter PDF App

日本語の短いヒアリングから恋人への文章を作成し、承認後に装飾画像とA4 PDFへ進むWebアプリです。

## セットアップ

```powershell
npm install
npm run build
npm run dev
```

ブラウザで `http://127.0.0.1:8787` を開きます。

## モックモード

`wrangler.jsonc` の `MOCK_MODE=true` ではOpenAIを呼び出さず、ローカルメモリ内でセッションを保持します。通常の開発・単体テスト・モックE2Eに使用します。本番ではD1/R2/Workflows/Browser Runへ接続します。

## セットアップ前提

- Node.js 24以上
- D1/R2/Browser Runは本番接続前に `AI/PREPARATION_CHECKLIST.txt` を確認
- OpenAIキーは `.dev.vars` またはWrangler Secretへ設定し、ソースやログへ出さない
- モデル名は環境変数 `MODEL_TEXT` / `MODEL_IMAGE` で差し替える

## 仮定

- MVPは1セッション1通、ログインなし、セッション有効期間24時間
- モック版は再起動でセッションが消える
- 現時点のモックPDFは開ける最小PDFであり、日本語フォント埋め込み済みの本番PDFではない
- 実OpenAI、D1、R2、Workflows、Browser Runは次のフェーズで接続する
