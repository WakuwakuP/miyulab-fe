# 開発ワークフロー

miyulab-fe の開発環境セットアップからビルド・テスト・デプロイまでの包括的なガイド。

---

## 1. ローカル開発セットアップ

### 前提条件

| ツール | 要件 |
|--------|------|
| **Node.js** | v18 以上（corepack 対応バージョン） |
| **Yarn** | v4.13.0（corepack 経由で自動管理） |
| **corepack** | Node.js に同梱。有効化が必要 |

### 初回セットアップ手順

```bash
# 1. corepack の有効化（初回のみ）
corepack enable

# 2. 依存パッケージのインストール
yarn install

# 3. 開発サーバーの起動（HTTPS モード）
yarn dev
```

`package.json` に `"packageManager": "yarn@4.13.0"` が指定されており、corepack が正確なバージョンの Yarn を自動的にダウンロード・使用する。

### Yarn Berry の設定

`.yarnrc.yml` の主要設定:

```yaml
nodeLinker: node-modules

plugins:
  - path: .yarn/plugins/@yarnpkg/plugin-licenses.cjs
    spec: "https://raw.githubusercontent.com/mhassan1/yarn-plugin-licenses/v0.13.1/bundles/@yarnpkg/plugin-licenses.js"

yarnPath: .yarn/releases/yarn-4.13.0.cjs
```

- **nodeLinker**: `node-modules` — Plug'n'Play (PnP) ではなく、従来の `node_modules/` ディレクトリを使用
- **yarnPath**: Yarn 本体をリポジトリ内に固定し、全開発者が同一バージョンで作業

---

## 2. 環境変数

環境変数は `src/util/environment.ts` で一元管理されている。すべて `NEXT_PUBLIC_` プレフィックス付きで、クライアントサイドからもアクセス可能。

| 環境変数 | 説明 | デフォルト値 |
|----------|------|-------------|
| `NEXT_PUBLIC_APP_URL` | アプリケーションのデプロイ URL | `http://localhost:3000`（Vercel 環境では `NEXT_PUBLIC_VERCEL_URL` にフォールバック） |
| `NEXT_PUBLIC_BACKEND_URL` | 接続先 Fediverse サーバーの URL | `https://pl.waku.dev` |
| `NEXT_PUBLIC_BACKEND_SNS` | バックエンドの SNS 種別 | `pleroma` |
| `NEXT_PUBLIC_MAX_LENGTH` | タイムラインストレージの最大レコード数（クリーンアップ閾値） | `100000` |
| `NEXT_PUBLIC_TIMELINE_QUERY_LIMIT` | タイムラインクエリで一度に取得する最大レコード数 | `50` |

### NEXT_PUBLIC_BACKEND_SNS の許容値

```typescript
// src/util/environment.ts より
assert(
  process.env.NEXT_PUBLIC_BACKEND_SNS === 'mastodon' ||
    process.env.NEXT_PUBLIC_BACKEND_SNS === 'pleroma' ||
    process.env.NEXT_PUBLIC_BACKEND_SNS === 'friendica' ||
    process.env.NEXT_PUBLIC_BACKEND_SNS === 'firefish' ||
    process.env.NEXT_PUBLIC_BACKEND_SNS === 'misskey' ||
    process.env.NEXT_PUBLIC_BACKEND_SNS === undefined,
  'Invalid NEXT_PUBLIC_BACKEND_SNS',
)
```

不正な値が設定されるとアサーションエラーで起動が失敗する。

### 環境変数の設定例

プロジェクトルートに `.env.local` ファイルを作成:

```env
NEXT_PUBLIC_APP_URL=https://miyulab.example.com
NEXT_PUBLIC_BACKEND_URL=https://mastodon.social
NEXT_PUBLIC_BACKEND_SNS=mastodon
```

---

## 3. ビルド・テスト・リントコマンド

> **⚠️ 重要**: `npx` でビルド・コードチェック・テストを実行してはいけません。必ず `yarn` 経由で実行してください。

### scripts 一覧

`package.json` の全スクリプト:

| コマンド | 実行内容 | 説明 |
|----------|----------|------|
| `yarn dev` | `next dev --experimental-https` | HTTPS 対応の開発サーバー起動 |
| `yarn build` | `next build` | 本番ビルド（`prebuild` で ZenStack generate + migrate も実行） |
| `yarn start` | `next start` | 本番ビルド済みアプリの起動 |
| `yarn check` | `biome check .` | Biome によるリント＆フォーマットチェック |
| `yarn check:fix` | `biome check --write .` | Biome による自動修正 |
| `yarn test` | `vitest run` | テストの一括実行 |
| `yarn test:run` | `vitest run` | テストの一括実行（`test` と同一） |
| `yarn test:watch` | `vitest` | ファイル変更を監視してテストを自動再実行 |
| `yarn test:coverage` | `vitest run --coverage` | カバレッジレポート付きテスト実行 |
| `yarn generate` | `zen generate --lite` | ZenStack のスキーマ生成（ライトモード） |
| `yarn prepare` | `husky install` | Husky の Git hook をインストール |

### prebuild フック

`yarn build` 実行時、ビルド前に自動的に以下が実行される:

```json
"prebuild": "zenstack generate && zenstack migrate deploy"
```

ZenStack のスキーマ生成とマイグレーション適用が本番ビルドの前提として組み込まれている。

### Vitest テスト設定

`vitest.config.ts` の主要設定:

```typescript
export default defineConfig({
  resolve: {
    alias: {
      app: path.resolve(__dirname, 'src/app'),
      components: path.resolve(__dirname, 'src/components'),
      types: path.resolve(__dirname, 'src/types'),
      util: path.resolve(__dirname, 'src/util'),
    },
  },
  test: {
    coverage: {
      include: ['src/util/db/sqlite/**'],
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
    },
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
})
```

- **テスト対象**: `src/**/*.test.ts` パターンに一致するファイル
- **テスト環境**: Node.js（ブラウザ環境ではない）
- **グローバル API**: `describe`, `it`, `expect` 等をインポートなしで使用可能
- **パスエイリアス**: `tsconfig.json` の `baseUrl: "src"` に合わせたエイリアス設定
- **カバレッジ対象**: `src/util/db/sqlite/` 配下に限定（V8 プロバイダー使用）

### Biome リント・フォーマット設定

`biome.json` のポイント:

**フォーマッター設定**:
- シングルクォート (`quoteStyle: "single"`)
- セミコロンなし (`semicolons: "asNeeded"`)
- 末尾カンマあり (`trailingCommas: "all"`)
- アロー関数の引数は常に括弧付き (`arrowParentheses: "always"`)

**リンタードメイン**:
```json
"domains": {
  "next": "all",
  "project": "recommended",
  "react": "recommended"
}
```

**Assist（自動整理）**:
- インポートの自動整理 (`organizeImports: "on"`)
- JSX 属性のソート (`useSortedAttributes: "on"`)
- オブジェクトキー・プロパティのソート (`useSortedKeys: "on"`, `useSortedProperties: "on"`)

**除外対象**:
- `src/components/ui/**/*` — shadcn/ui 生成コード
- `src/zenstack/**/*` — ZenStack 生成コード
- `node_modules/`, `.next/`, `out/`, `build/`
- `plans/**/*`, `.github/prompts/**/*`

**VCS 連携**:
```json
"vcs": {
  "clientKind": "git",
  "defaultBranch": "master",
  "enabled": true,
  "useIgnoreFile": true
}
```

---

## 4. ディレクトリ構造

### src/ 以下の全体マップ

```text
src/
├── app/                        # Next.js App Router
│   ├── layout.tsx              # Provider チェーン（複数の Context を合成）
│   ├── page.tsx                # ホームページ — タイムライングループ表示
│   ├── error.tsx               # エラーバウンダリ
│   ├── not-found.tsx           # 404 ページ
│   ├── globals.css             # グローバル CSS（Tailwind CSS v4 ディレクティブ）
│   ├── _components/            # ページレベルコンポーネント（機能単位）
│   │   ├── AccountsPanel.tsx       # アカウント管理パネル
│   │   ├── DatabaseStatsPanel.tsx  # DB 統計表示
│   │   ├── DetailPanel.tsx         # 詳細表示パネル
│   │   ├── DynamicTimeline.tsx     # 動的タイムライン
│   │   ├── MainPanel.tsx           # メインパネル
│   │   ├── MixedTimeline.tsx       # 複合タイムライン
│   │   ├── NotificationTimeline.tsx # 通知タイムライン
│   │   ├── SettingPanel.tsx        # 設定パネル
│   │   ├── FlowEditor/            # フローエディタ
│   │   ├── NodeEditor/             # ノードエディタ
│   │   ├── TimelineManagement/     # タイムライン管理
│   │   └── ...
│   ├── _parts/                 # 再利用可能な低レベル UI 部品
│   │   ├── Status.tsx              # ステータス（投稿）表示
│   │   ├── Notification.tsx        # 通知表示
│   │   ├── Media.tsx               # メディア表示
│   │   ├── Poll.tsx                # 投票表示
│   │   ├── Modal.tsx               # モーダルダイアログ
│   │   ├── Actions.tsx             # アクションボタン群
│   │   ├── FilterControls.tsx      # フィルターコントロール
│   │   └── ...
│   ├── actions/                # Server Actions
│   │   └── queryLog.server.ts
│   └── api/                    # API Routes
│       └── attachment/             # メディアプロキシ
├── components/                 # 共有 UI コンポーネント
│   ├── lib/                        # ユーティリティ関数 (cn() 等)
│   └── ui/                         # shadcn/ui 生成コンポーネント（編集禁止）
├── hooks/                      # グローバル Hooks
│   └── useWorkerQueryLogBridge.ts
├── types/                      # アプリ全体の型定義
│   └── types.ts                    # Backend 型、TimelineConfig 等
├── util/                       # ユーティリティ・ビジネスロジック
│   ├── db/                     # データベース層
│   │   ├── sqlite/                 # SQLite WASM 操作
│   │   ├── neon/                   # Neon (PostgreSQL) 操作
│   │   ├── query-ir/               # クエリ中間表現
│   │   ├── dbQueue.ts              # DB キュー管理
│   │   └── errors.ts               # DB エラー定義
│   ├── hooks/                  # タイムラインデータ取得 Hooks
│   │   ├── useTimeline.ts          # メインタイムライン Hook
│   │   ├── useTimelineData.ts      # タイムラインデータ管理
│   │   ├── useTimelineDataSource.ts # データソース抽象化
│   │   ├── buildTimelineItems.ts   # タイムラインアイテム構築
│   │   └── ...
│   ├── streaming/              # WebSocket ストリーム管理
│   │   ├── streamRegistry.ts       # ストリーム登録管理
│   │   ├── initializeStream.ts     # ストリーム初期化
│   │   ├── setupStreamHandlers.ts  # ストリームハンドラ設定
│   │   └── ...
│   ├── provider/               # React Context Provider 群
│   │   ├── AppsProvider.tsx        # アプリケーション状態
│   │   ├── SettingProvider.tsx      # 設定管理
│   │   ├── TimelineProvider.tsx     # タイムライン状態
│   │   ├── StreamingManagerProvider.tsx # ストリーミング管理
│   │   ├── StatusStoreProvider.tsx  # ステータスストア
│   │   ├── StartupCoordinator.tsx   # 起動時の初期化調整
│   │   └── ...（計 14 Provider）
│   ├── queryBuilder/           # SQL クエリ構築
│   │   ├── buildQueryFromConfig.ts # 設定からクエリを生成
│   │   ├── filterConditions.ts     # フィルター条件定義
│   │   ├── parseQueryToConfig.ts   # クエリから設定へ変換
│   │   └── ...
│   ├── migration/              # DB スキーママイグレーション
│   │   └── migrateTimeline.ts
│   ├── misskey/                # Misskey 固有処理
│   ├── debug/                  # デバッグユーティリティ
│   ├── explainQueryPlan/       # クエリ実行計画分析
│   ├── environment.ts          # 環境変数定義
│   ├── constants.ts            # 定数定義
│   ├── GetClient.ts            # megalodon クライアント取得
│   ├── timelineFetcher.ts      # タイムラインフェッチャー
│   ├── timelineRefresh.ts      # タイムラインリフレッシュ
│   └── ...
└── zenstack/                   # ZenStack 生成コード（編集禁止）
```

### プロジェクトルートのディレクトリ

| ディレクトリ | 説明 |
|-------------|------|
| `docs/` | プロジェクトドキュメント（タイムライン設計、ナレッジ、DB 設計等） |
| `docs/timeline/` | タイムラインシステム設計ドキュメント |
| `docs/knowledge/` | 実装パターンのナレッジベース |
| `docs/domain/` | ドメイン知識ドキュメント |
| `specs/` | マイグレーション計画・仕様書（例: `timeline-query-optimization.md`） |
| `migrations/` | ZenStack DB マイグレーションファイル（例: `20260330101646_init`） |
| `public/` | 静的アセット |
| `certificates/` | HTTPS 開発用の証明書 |

---

## 5. コミット前チェックリスト

### 必須チェック

コミット前に以下の 2 コマンドを**必ず**実行し、成功を確認すること:

```bash
# 1. Biome によるリント＆フォーマットチェック
yarn check

# 2. 本番ビルド（TypeScript 型チェック含む）
yarn build
```

### Husky pre-commit hook

`.husky/pre-commit` で自動的にチェックが実行される:

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

yarn check
yarn build
```

コミット時にこの hook が自動で走り、`yarn check` または `yarn build` が失敗するとコミットがブロックされる。

### lint-staged

`package.json` に `lint-staged` が devDependencies に含まれており、ステージングされたファイルに対して Biome チェックが実行される。

### チェックリストまとめ

- [ ] `yarn check` が成功する（リント＆フォーマットエラーなし）
- [ ] `yarn build` が成功する（型エラー・ビルドエラーなし）
- [ ] `yarn test` が成功する（テスト失敗なし）
- [ ] 新機能を追加した場合、テストも追加する
- [ ] `npx` ではなく `yarn` コマンドを使用している

---

## 6. 技術スタック概要

### コアフレームワーク

| 技術 | バージョン | 用途 |
|------|-----------|------|
| **Next.js** | 16.x | App Router ベースのフルスタックフレームワーク |
| **React** | 19.x | UI ライブラリ |
| **React Compiler** | `babel-plugin-react-compiler` | 自動メモ化による最適化（`next.config.mjs` で `reactCompiler: true`） |
| **TypeScript** | 6.x | strict mode で型安全性を確保 |

### スタイリング

| 技術 | バージョン | 用途 |
|------|-----------|------|
| **Tailwind CSS** | v4.x | ユーティリティファースト CSS（PostCSS 経由） |
| **shadcn/ui** | — | `src/components/ui/` に生成されるコンポーネント群 |
| **Lucide React** | 1.x | アイコンライブラリ |
| **class-variance-authority** | 0.7.x | コンポーネントバリアント管理 |
| **tailwind-merge** | 3.x | Tailwind クラスの安全なマージ |

### データ管理

| 技術 | バージョン | 用途 |
|------|-----------|------|
| **SQLite WASM** | `@sqlite.org/sqlite-wasm` 3.x | ブラウザ内 SQLite データベース |
| **ZenStack** | 3.x | ORM・スキーマ管理・マイグレーション |
| **pg** | 8.x | PostgreSQL クライアント（Neon 等のサーバーサイド DB 接続） |

### Fediverse 連携

| 技術 | バージョン | 用途 |
|------|-----------|------|
| **megalodon** | 10.x | Mastodon/Pleroma 互換 API クライアント |
| **misskey-js** | 2026.x-beta | Misskey 固有 API 対応 |
| **mfm-js** | 0.25.x | MFM (Misskey Flavored Markdown) パーサー |

### UI コンポーネント

| 技術 | バージョン | 用途 |
|------|-----------|------|
| **react-virtuoso** | 4.x | 大量リストの仮想スクロール |
| **@dnd-kit** | core 6.x / sortable 10.x | ドラッグ＆ドロップ |
| **@xyflow/react** | 12.x | フローチャートエディタ |
| **emoji-picker-react** | 4.x | 絵文字ピッカー |
| **react-player** | 3.x | メディアプレイヤー |
| **react-hook-form** | 7.x | フォーム管理 |
| **cmdk** | 1.x | コマンドパレット |
| **embla-carousel-react** | 8.x | カルーセル |

### 開発ツール

| 技術 | バージョン | 用途 |
|------|-----------|------|
| **Biome** | 2.x | リント＆フォーマット（ESLint/Prettier 不使用） |
| **Vitest** | 4.x | テストフレームワーク |
| **@vitest/coverage-v8** | 4.x | コードカバレッジ |
| **Husky** | 9.x | Git hooks 管理 |
| **lint-staged** | 16.x | ステージファイルのリント |

### Next.js 設定のポイント

`next.config.mjs` の重要な設定:

```javascript
const nextConfig = {
  // React Compiler の有効化
  reactCompiler: true,

  // Turbopack の有効化
  turbopack: {},

  // SQLite WASM 用のヘッダー設定
  async headers() {
    return [{
      headers: [
        { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      ],
      source: '/:path*',
    }]
  },
}
```

- **COEP/COOP ヘッダー**: SQLite WASM が `SharedArrayBuffer` を使用するために必要
- **React Compiler**: 自動メモ化により `useMemo`/`useCallback` の手動管理が不要
- **Turbopack**: 開発時のバンドル高速化

### TypeScript 設定

`tsconfig.json` の重要設定:

```json
{
  "compilerOptions": {
    "strict": true,
    "baseUrl": "src",
    "paths": {
      "@public/*": ["../public/*"]
    }
  }
}
```

- **strict mode**: 厳密な型チェックが有効
- **baseUrl**: `src` を基準とした絶対パスインポート（例: `import { Backend } from 'types/types'`）
- **@public/\***: `public/` ディレクトリへのパスエイリアス

---

## 次に読むべきドキュメント

- [Fediverse の基本概念](01-fediverse-concepts.md) — Mastodon/Pleroma 等の Fediverse プロトコルとこのアプリケーションが扱うドメインの基礎知識
