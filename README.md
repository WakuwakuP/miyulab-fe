# miyulab-fe

miyulab-fe は、複数の Fediverse サーバーを横断して使うための Web クライアントです。
Mastodon / Pleroma / Friendica / Firefish / Misskey 互換バックエンドの API と Streaming API から取得した投稿・通知を、ブラウザ内 SQLite に正規化して保存し、カスタマイズ可能なタイムラインとして表示します。

## 主な特徴

- 複数アカウント・複数バックエンドを 1 つの画面に統合
- ホーム、ローカル、連合、通知、タグタイムラインの表示
- タイムラインの追加、並べ替え、表示切替、タブグループ化
- バックエンド、公開範囲、言語、メディア有無、ブースト、引用、返信、通知種別などのフィルタ
- Advanced Query / Flow Editor による Query IR ベースの高度な絞り込み
- WebSocket Streaming API によるリアルタイム更新
- SQLite Wasm + OPFS によるブラウザ内キャッシュと重複排除
- 添付メディアを安全に表示する attachment proxy

## 技術スタック

- Next.js 16 App Router
- React 19 + React Compiler
- TypeScript 6 strict mode
- Tailwind CSS v4 + shadcn/ui
- megalodon / misskey-js
- SQLite Wasm + OPFS + Web Worker
- Vitest
- Biome
- ZenStack

## セットアップ

Node.js 24 系と Corepack の利用を推奨します。パッケージマネージャーはリポジトリ内で Yarn 4.17.0 に固定されています。

```bash
corepack enable
yarn install
yarn dev
```

`yarn dev` は SQLite Wasm の公開アセットを `public/` にコピーしてから、Next.js の HTTPS 開発サーバーを起動します。
HTTP のローカルサーバーが必要な場合は、依存関係インストール後に次のように起動できます。

```bash
yarn copy:sqlite-wasm
./node_modules/.bin/next dev --port 3000
```

ビルド、チェック、テストは `npx` ではなく Yarn 経由で実行してください。

## 環境変数

環境変数は `src/util/environment.ts` で定義されています。未設定でもローカル起動できます。

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_BACKEND_URL=https://pl.waku.dev
NEXT_PUBLIC_BACKEND_SNS=pleroma
NEXT_PUBLIC_MAX_LENGTH=100000
NEXT_PUBLIC_TIMELINE_QUERY_LIMIT=50
```

| 変数 | 用途 | デフォルト |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | アプリケーションの公開 URL。Vercel では `NEXT_PUBLIC_VERCEL_URL` にもフォールバックします。 | `http://localhost:3000` |
| `NEXT_PUBLIC_BACKEND_URL` | 初期接続先の Fediverse サーバー URL | `https://pl.waku.dev` |
| `NEXT_PUBLIC_BACKEND_SNS` | 初期接続先のバックエンド種別 | `pleroma` |
| `NEXT_PUBLIC_MAX_LENGTH` | ローカルストレージ上の投稿保持上限 | `100000` |
| `NEXT_PUBLIC_TIMELINE_QUERY_LIMIT` | タイムラインクエリ 1 回あたりの取得件数 | `50` |

`NEXT_PUBLIC_BACKEND_SNS` に指定できる値は、現在の起動時検証では `mastodon`、`pleroma`、`friendica`、`firefish`、`misskey` です。
アプリ内のバックエンド型には `gotosocial` と `pixelfed` も含まれていますが、初期環境変数としては上記の検証対象に合わせてください。

## よく使うコマンド

| コマンド | 内容 |
| --- | --- |
| `yarn dev` | SQLite Wasm アセットをコピーし、HTTPS 開発サーバーを起動 |
| `yarn build` | SQLite Wasm アセットをコピーし、Next.js の本番ビルドを実行 |
| `yarn start` | 本番ビルド済みアプリを起動 |
| `yarn check` | Biome の lint / format チェック |
| `yarn check:fix` | Biome の自動修正 |
| `yarn test:run` | Vitest を 1 回実行 |
| `yarn test:watch` | Vitest を watch モードで実行 |
| `yarn test:coverage` | Vitest のカバレッジ付き実行 |
| `yarn generate` | ZenStack の生成処理 |
| `yarn copy:sqlite-wasm` | `@sqlite.org/sqlite-wasm` の配布ファイルを `public/` にコピー |

`yarn build` の前には `prebuild` が走り、ZenStack の生成処理を実行します。
`DATABASE_URL` が設定されている場合は `zen migrate deploy` も実行します。
`VERCEL_ENV=production` では `DATABASE_URL` が必須です。

## アーキテクチャ概要

```text
Fediverse server
  | REST API / Streaming API
  v
megalodon / Misskey adapter
  v
StatusStore / StreamingManager / timelineFetcher
  v
SQLite Wasm Worker
  v
OPFS or in-memory SQLite
  v
Query IR / timeline hooks
  v
React timeline UI
```

すべての投稿・通知は一度 SQLite に保存されます。
UI は API レスポンスを直接保持するのではなく、`TimelineConfigV2` から生成した Query IR を SQLite Worker で実行し、その結果を React コンポーネントに渡します。

SQLite は OPFS SAH Pool、通常 OPFS、インメモリ DB の順でフォールバックします。
OPFS と SQLite Wasm のために、`next.config.mjs` では全ルートに COOP / COEP ヘッダーを設定しています。

## ディレクトリ

```text
src/app/              App Router、ページ、タイムライン UI、パネル、API Route
src/app/_components/  ページ機能単位のコンポーネント
src/app/_parts/       アプリ内で再利用する低レベル UI
src/components/ui/    shadcn/ui 生成コンポーネント
src/types/            アプリ全体の型定義
src/util/             Provider、hooks、streaming、adapter、共有ロジック
src/util/db/          SQLite、Query IR、schema、migration、queue
docs/domain/          実装から抽出したドメインモデル
docs/timeline/        タイムラインシステムの詳細設計
docs/knowledge/       Next.js / UI / テストなどの実装メモ
scripts/              SQLite Wasm アセットコピーなどの補助スクリプト
```

## 開発時の注意

- import は `src` を baseUrl とした絶対パスを優先します。
- `src/components/ui/**` は shadcn/ui 生成物です。必要がなければ直接編集しません。
- タイムラインデータは SQLite と Query IR を経由させます。
- ストリーミング購読は `StreamingManagerProvider` と `StatusStoreProvider` に集約されています。
- SQLite 書き込み経路を追加するときは、`changedTables` と `ChangeHint` を落とさないでください。
- `backendUrl` がバックエンド識別の主キーです。配列 index ベースの扱いはレガシー互換用です。
- SQLite Wasm の更新後は `yarn copy:sqlite-wasm` を実行し、更新された `public/sqlite3*` を確認してください。

## 詳細ドキュメント

- [ドメイン知識](docs/domain/README.md)
- [タイムラインシステム設計](docs/timeline/README.md)
- [DB テーブル設計](docs/db-table-design.md)
- [Next.js / UI / テスト知識](docs/knowledge/README.md)

