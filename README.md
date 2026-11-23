# Letter PDF App

専門スタッフが入力した喜怒哀楽4件から、文章4件・画像4件・A4縦4ページPDFを作成するWebアプリです。AIヒアリングは使用しません。

## セットアップ

```powershell
npm install
npm run build
npm run dev
```

ブラウザで `http://127.0.0.1:5173` を開きます。Viteが画面をホットリロードし、`/api`は `http://127.0.0.1:8787` のWorkerへプロキシします。
Workerのみを確認する場合は `http://127.0.0.1:8787` を開けます。

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

## v2 APIとモックモード

`wrangler.jsonc` の `MOCK_MODE=true` ではOpenAIを呼び出さず、4件のモック文章・画像を生成します。D1が利用できる場合、セッション状態はスナップショットとして保存されます。実モードでは `MOCK_MODE=false` とし、`.dev.vars` またはWorker Secretの `OPENAI_API_KEY` が必須です。

主要APIは `POST /api/sessions`（4入力）、`POST /api/cards/generate`、`PATCH /api/cards`、`POST /api/cards/approve`、`POST /api/images/:emotion/retry`、`POST /api/pdf/retry`、`GET /api/download` です。

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

- 1セッション1カードセット、ログインなし、セッション有効期間24時間
- 実OpenAI・R2・Browser Run・本番D1の接続と、実PDFの日本語文字選択は未検証
- モックPDFは4ページの構造確認用で、実PDF品質の代替ではない
