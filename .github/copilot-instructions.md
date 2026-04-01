# Project Guidelines — miyulab-fe

Fediverse (Mastodon/Pleroma互換) Webクライアント。マルチアカウント、ブラウザ内SQLiteキャッシュ、WebSocketストリーミングを特徴とする。

## Build and Test

```bash
yarn install          # 依存インストール (corepack + immutable installs)
yarn dev              # 開発サーバー起動 (HTTPS, --experimental-https)
yarn build            # 本番ビルド — コミット前に必ず成功を確認
yarn check            # Biome lint & format チェック
yarn check:fix        # Biome 自動修正
yarn test             # vitest テスト実行
```

**コミット前に `yarn build` と `yarn check` を必ず実行すること。** Husky pre-commit hookでもlint-stagedが走る。
**`npx`でビルド・コードチェック・テストを実行してはいけない**

## Tech Stack

- **Framework**: Next.js 16 + React 19 + React Compiler
- **Language**: TypeScript (strict mode, baseUrl: `src`)
- **Styling**: Tailwind CSS v4 + shadcn/ui (Lucide icons)
- **Fediverse API**: megalodon ライブラリ
- **ローカルDB**: SQLite Wasm + Dexie (IndexedDB)
- **Lint/Format**: Biome 2.x (`biome.json` — ESLint/Prettier は不使用)
- **仮想スクロール**: react-virtuoso

## Architecture

```text
src/
├── app/                    # Next.js App Router
│   ├── layout.tsx          # Provider チェーン (13層のContext)
│   ├── page.tsx            # ホーム — タイムライングループ表示
│   ├── _components/        # ページレベルコンポーネント (機能単位)
│   ├── _parts/             # 再利用可能な低レベルUI部品
│   └── api/attachment/     # メディアプロキシ API Route
├── components/ui/          # shadcn/ui 生成コンポーネント (編集しない)
├── types/types.ts          # アプリ全体の型定義
└── util/
    ├── db/                 # SQLite/Dexie データ層
    ├── hooks/              # タイムラインデータ取得 Hooks
    ├── streaming/          # WebSocket ストリーム管理
    ├── provider/           # React Context Provider 群
    ├── migration/          # DB スキーママイグレーション
    ├── environment.ts      # 環境変数定義
    └── queryBuilder.ts     # SQL クエリ構築
```

**データフロー**: Fediverse Server → megalodon → StreamingManager/Fetcher → SQLite → Hooks → React UI

## Conventions

- **コンポーネント配置**: ページ機能は `_components/`、汎用UI部品は `_parts/`、shadcn生成物は `components/ui/`
- **状態管理**: グローバル状態は React Context (`util/provider/`) で管理。外部状態ライブラリは不使用
- **インポートパス**: `src` をbaseUrlとした絶対パス (`util/hooks/xxx`, `types/types` 等)。`@public/*` で `public/` を参照
- **Biome ルール**: `src/components/ui/**` はBiome対象外 (shadcn生成コード)
- **バックエンド対応**: `Backend` 型 = `'mastodon' | 'pleroma' | 'friendica' | 'firefish' | 'gotosocial' | 'pixelfed'`
- **タイムライン設定**: `TimelineConfigV2` 型でフィルタ・表示を定義。詳細は `docs/timeline/` 参照

## Environment Variables

```env
NEXT_PUBLIC_APP_URL=<デプロイURL>         # default: http://localhost:3000
NEXT_PUBLIC_BACKEND_URL=<バックエンドURL> # default: https://pl.waku.dev
NEXT_PUBLIC_BACKEND_SNS=<SNS名>           # optional: 'mastodon' | 'pleroma' | etc.
```

## Key Documentation

- `docs/timeline/` — タイムラインシステム設計 (アーキテクチャ〜コンポーネント)
- `docs/knowledge/` — 実装パターン (Server/Client Components, テスト, Storybook)
- `docs/db-table-design.md` — DBテーブル設計
- `specs/` — マイグレーション計画・仕様
