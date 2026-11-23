# Letter PDF App - リポジトリ棚卸し

最終更新: 2026-11-23

## 概要

`Letter PDF App` は、恋人へ伝えたいことを日本語で入力し、AIによるヒアリング、文章案の確認・編集、装飾画像、A4縦PDFの生成までを行うフルスタックWebアプリです。

- UI: React 19 + Vite
- API: Hono + Cloudflare Workers
- データ検証: Zod
- AI本文: OpenAI Responses API
- AI画像: OpenAI Images API
- 永続化予定: Cloudflare D1 / R2
- PDF予定: Cloudflare Browser Run
- テスト: Vitest / Playwright

現在はモック経路と実API経路を切り替えられますが、セッション状態は主にWorker内メモリで管理されます。本番相当の永続化、Workflows、Cronによる期限削除は未完了です。

## リポジトリ構成

```text
.
|-- AI/                       設計資料・AI指示・準備チェックリスト
|   |-- AGENTS.md             開発エージェント向けルール
|   |-- DESIGN.md             MVP仕様、状態、DB、API、セキュリティ
|   |-- firstPrompt.md        初回実装指示と環境に関する補足
|   |-- FLOWCHART.mmd         状態遷移フロー図
|   |-- PREPARATION_CHECKLIST.txt  本番接続前チェック
|   |-- PHASE2_USER_SETUP.txt      実API接続前チェック
|   |-- phase2Prompt.md       実API接続フェーズの指示
|   |-- hearing.json          ヒアリング制約
|   |-- prompts/              AIプロンプト原文
|   `-- schemas/              AI返却JSONスキーマ案
|-- migrations/
|   `-- 0001_initial.sql      D1テーブル定義
|-- public/
|   |-- card.svg              ブラウザ側カードテンプレート
|   `-- noto-sans-jp.woff2    日本語フォント
|-- src/
|   |-- client/
|   |   |-- main.tsx          React画面とAPI呼出し
|   |   `-- styles.css        全画面スタイル
|   |-- shared/
|   |   `-- schemas.ts        セッション状態・本文のZodスキーマ
|   `-- worker/
|       |-- index.ts          Honoルート、状態遷移、モック/実処理
|       |-- openai.ts         OpenAI SDKラッパー
|       |-- prompts.ts        ヒアリング/文章/画像プロンプト
|       |-- render.ts         A4 HTML/PDFレイアウト
|       `-- noto-sans-jp-base64.ts  PDF埋込用フォント
|-- tests/
|   |-- schemas.test.ts       Vitestスキーマ・レイアウト・プロンプト
|   `-- e2e/mvp.spec.ts       モックヒアリング開始のE2E
|-- .vscode/                  開発タスクとデバッグ設定
|-- dist/client/              ビルド成果物
|-- package.json              npmスクリプトと依存関係
|-- wrangler.jsonc            Cloudflare bindingsと環境設定
|-- vite.config.ts            Viteビルドと/apiプロキシ
|-- playwright.config.ts      Playwright設定
|-- index.html                ReactエントリーHTML
`-- README.md                 既存のセットアップ説明
```

## アプリの処理フロー

1. ユーザーが初期メッセージを入力し、AI処理への同意を選択。
2. `POST /api/sessions` がHttpOnly Cookieとセッションを作成。
3. `POST /api/hearing/advance` が質問または文章化判定を行う。
4. 回答は `/api/hearing/answer` に保存され、最大5問まで進む。
5. ユーザーは途中で文章化を選択できる。
6. `/api/draft/generate` がタイトル、本文、画像指示を生成。
7. ユーザーが本文を編集し承認すると画像生成フェーズへ進む。
8. 装飾画像を確認し承認するとPDF生成フェーズへ進む。
9. `/api/download` が本人Cookieを持つセッションのPDFを返す。
10. 中止、期限切れ、画像/PDF失敗、再試行の分岐を持つ。

## 状態一覧

サーバー側の真実となる状態は `src/shared/schemas.ts` と `src/worker/index.ts` で定義されています。

- `HEARING`
- `TEXT_REVIEW`
- `IMAGE_RUNNING`
- `IMAGE_ERROR`
- `ART_REVIEW`
- `PDF_RUNNING`
- `PDF_ERROR`
- `READY`
- `COMPLETED`
- `CANCELLED`
- `EXPIRED`

## 主要API

| メソッド | パス | 役割 |
|---|---|---|
| POST | `/api/sessions` | セッション作成 |
| GET | `/api/sessions/current` | 現在セッション取得 |
| DELETE | `/api/sessions/current` | 中止・セッション削除 |
| POST | `/api/hearing/advance` | 質問生成または文章化 |
| POST | `/api/hearing/answer` | 質問への回答保存 |
| POST | `/api/draft/generate` | 文章案生成 |
| PATCH | `/api/draft` | 文章案の編集・新revision |
| POST | `/api/draft/approve` | 文章承認と画像生成開始 |
| GET | `/api/image/current` | 本人向け装飾画像 |
| POST | `/api/image/approve` | 見た目承認とPDF生成開始 |
| POST | `/api/image/skip` | 画像なしで進む |
| POST | `/api/pdf/retry` | PDF再生成 |
| GET | `/api/download` | PDFダウンロード |
| POST | `/api/complete` | 完了状態へ遷移 |

## 主要プログラムの役割

### `src/client/main.tsx`

- セッション開始、ヒアリング、本文編集、承認、画像/画像なし選択、PDF再試行、ダウンロード、完了、中止を制御。
- APIレスポンスのバージョン競合を画面更新に反映。
- テキスト入力上限、同意チェック、ローディング、エラー表示を実装。

### `src/worker/index.ts`

- HonoによるAPIルートとバージョン、状態、revisionの検証。
- セッションIDとCookieトークンをSHA-256で照合。
- モック時は固定質問、モック文章、簡易PDFを返す。
- 実モードではOpenAI本文、画像、Browser Run PDFを呼び出す。
- 画像/PDFはメモリ内またはR2に保存。

### `src/worker/openai.ts`

- Responses APIでヒアリング判定と文章を構造化出力として取得。
- ZodでAIレスポンスを検証。
- Images APIでPNGを生成し、PNGヘッダーとサイズ上限を検査。

### `src/worker/prompts.ts`

- ヒアリング、文章生成、画像生成の実行時指示。
- ヒアリングは最大5問、1問ずつ、未言及事項を補わない制約。
- 画像は文字なし・横長カード・動物擬人化・印刷用構図を指示。

### `src/worker/render.ts`

- タイトル24文字、本文60文字を固定レイアウトで検査。
- ユーザー文字列をHTMLエスケープ。
- 日本語フォント埋込みとA4縦のカードレイアウトを生成。

### `src/shared/schemas.ts`

- フロントが受け取るセッションスナップショット、状態、本文、画像、ダウンロード可否を検証。

### `migrations/0001_initial.sql`

- `sessions`, `messages`, `content_revisions`, `artifacts`, `pdfs`, `jobs` を定義。
- 現行のメモリ内セッション実装では一部テーブルの運用は未接続。

## モックモードと実モード

モックモードの判定は `MOCK_MODE !== "false"` です。

- モックモード: OpenAIを呼ばず固定ヒアリングとモック文章を返す。
- 実モード: `wrangler.jsonc` または環境変数で `MOCK_MODE=false` を設定。
- `.dev.vars` に `OPENAI_API_KEY` を設定。
- 本番ではWorker Secretとして `OPENAI_API_KEY` を登録。

ローカル起動:

```powershell
npm install
npm run dev
```

画面は `http://127.0.0.1:5173`、Workerは `http://127.0.0.1:8787` です。

実API経路で起動:

```powershell
npm run dev:real
```

## ビルドと検証

```powershell
npm run build
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

検証項目:

- Zodによるセッション契約
- 不正な状態値の拒否
- AIヒアリング/文章レスポンスの解析
- タイトル・本文の文字数制限
- HTMLレンダリングとA4設定
- プロンプトバージョン
- モックセッション開始のPlaywright E2E

検証時点のベースライン:

- ビルド成功
- リント成功
- 単体テストは画像プロンプト表記修正後に再確認が必要
- E2Eはモック環境で実行可能
- 実OpenAI、画像生成、Browser Run、D1、R2、本番デプロイは未検証

## Cloudflare設定

`wrangler.jsonc` のbinding:

- `DB`: D1。設定済みデータベースIDは `letter-pdf-db`
- `R2`: privateバケット `letter-pdf-private`
- `BROWSER`: Browser Run
- `ASSETS`: Viteビルド成果物

環境変数:

- `MOCK_MODE=false` またはモックモード
- `MODEL_TEXT=gpt-6.1-terra`
- `MODEL_IMAGE=gpt-image-2.6-flare`
- `OPENAI_API_KEY` はSecret

ローカルD1 migration:

```powershell
npx wrangler d1 migrations apply letter-pdf-db --local
```

本番migration:

```powershell
npx wrangler d1 migrations apply letter-pdf-db --remote
```

本番デプロイ:

```powershell
npm run deploy
```

## 現在実装済み

- Reactによる日本語UI
- Hono APIルート
- モックヒアリングとモック文章
- 質問上限、バージョン競合、状態競合、Cookie認証の骨格
- Zodによるリクエスト・レスポンス検証
- OpenAI Responses API・Images APIラッパー
- A4 HTMLレンダリング
- 日本語フォント埋込み
- Browser RunのPDF生成呼出し
- private R2への画像/PDF保存処理
- ダウンロードと再試行処理
- D1 migration定義

## 安全と運用上の注意

- APIキーはブラウザ、Git、ログ、チャット本文へ出さない。
- `.dev.vars` と `AI/.env` は実値を含む可能性があるためGit管理対象外を維持する。
- `R2` バケットとD1データは公開しない。
- ユーザー本文は運用ログへ出さない。
- セッションは24時間失効を設計として持つが、永続化と定期削除が実装されるまで制限として完全ではない。
- 承認前の本文を画像生成・PDF生成へ渡さない。
- 内容編集時は新revisionとし、旧画像/PDFを再利用しない。
- ユーザー文字列はHTMLエスケープする。
- モックPDFは検査可能な最小PDFで、本番品質の日本語埋込PDFではない。

## 変更中の主なファイル

作業開始時点のGit変更は次の通りです。

- `dist/client/index.html`
- `src/client/styles.css`
- `src/worker/openai.ts`
- `src/worker/prompts.ts`
- `tests/schemas.test.ts`
- `wrangler.jsonc`

変更をコミットする前に、ビルド成果物を含めるべきか確認してください。`dist/`, `.wrangler/`, `test-results/`, `node_modules/` は通常の生成物またはローカル環境です。

## 関連資料

- 機能仕様: [AI/DESIGN.md](AI/DESIGN.md)
- 開発ルール: [AI/AGENTS.md](AI/AGENTS.md)
- 状態遷移図: [AI/FLOWCHART.mmd](AI/FLOWCHART.mmd)
- 本番準備: [AI/PREPARATION_CHECKLIST.txt](AI/PREPARATION_CHECKLIST.txt)
- 実API準備: [AI/PHASE2_USER_SETUP.txt](AI/PHASE2_USER_SETUP.txt)
