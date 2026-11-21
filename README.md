# Letter PDF App

日本語の短いヒアリングから恋人への文章を作成し、承認後に装飾画像とA4 PDFへ進むWebアプリです。

## セットアップ

```powershell
npm install
npm run build
npm run dev
```

ブラウザで `http://127.0.0.1:8787` を開きます。

## Cloudflare bindings

`wrangler.jsonc` に次のbinding名を設定しています。

- `DB`: D1 `letter-pdf-db`
- `R2`: private R2 `letter-pdf-private`
- `BROWSER`: Browser Run

ローカルD1には次でmigrationを適用します。

```powershell
npx wrangler d1 migrations apply letter-pdf-db --local
```

本番R2バケットはCloudflare Dashboardで有効化・作成後に、ダッシュボードの公開アクセスを無効にしてください。

## モックモード

`wrangler.jsonc` の `MOCK_MODE=true` ではOpenAIを呼び出さず、ローカルメモリ内でセッションを保持します。CIや課金なしの開発に使用します。実モードでは `MOCK_MODE=false` とし、`.dev.vars` またはWorker Secretの `OPENAI_API_KEY` が必須です。キー未設定時は利用可能なふりをせず、503で停止します。

実モードでローカル確認する場合は `npm run dev:real` を使用します。

## Workers & Pages デプロイ

デプロイ前に次を確認します。

1. Cloudflare DashboardでR2を有効化し、`letter-pdf-private`バケットを作成する
2. OpenAIキーをWorker Secretへ登録する
3. 本番D1 migrationを適用する
4. `npm run deploy`でビルドとデプロイを実行する

OpenAIキーの登録例:

```powershell
npx wrangler secret put OPENAI_API_KEY --name letter-pdf-app
```

ローカルのキーを安全に登録する場合は、キー文字列をチャットやログに貼らず、`.dev.vars`から値だけをパイプで渡します。

本番D1 migration:

```powershell
npx wrangler d1 migrations apply letter-pdf-db --remote
```

### R2の詳細手順

1. [Cloudflare Dashboard](https://dash.cloudflare.com/)を開き、現在のアカウントを選択します。
2. 左メニューから **R2 object storage** を開きます。
3. 初回利用時は **Purchase R2** または **Enable R2** を押して、R2を有効化します。
4. **Create bucket** を押し、名前に `letter-pdf-private` を入力して作成します。
5. バケット設定を開き、**Public Development URL** と **Custom domain** が無効になっていることを確認します。
6. ターミナルで次を実行し、バケットを検証します。

```powershell
npx wrangler r2 bucket list
```

`letter-pdf-private` が一覧に表示されたら、次で再デプロイします。

```powershell
npx wrangler d1 migrations apply letter-pdf-db --remote
npm run deploy
npx wrangler deployments list --name letter-pdf-app
```

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
