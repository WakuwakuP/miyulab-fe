# マルチアカウントアーキテクチャ

miyulab-fe は複数の Fediverse アカウント（Mastodon、Pleroma、Friendica 等）を同時に扱えるマルチアカウント設計を採用している。本ドキュメントでは、アカウント管理からデータ分離、クロスアカウント参照に至るまでの設計と実装を解説する。

---

## 目次

1. [設計思想](#1-設計思想)
2. [テーブル関係図](#2-テーブル関係図)
3. [local_accounts テーブル](#3-local_accounts-テーブル)
4. [post_backend_ids によるクロスアカウント投稿参照](#4-post_backend_ids-によるクロスアカウント投稿参照)
5. [accountResolver — メモリキャッシュによる同期的解決](#5-accountresolver--メモリキャッシュによる同期的解決)
6. [object_uri による投稿の重複排除](#6-object_uri-による投稿の重複排除)
7. [local_account_id によるクエリスコーピング](#7-local_account_id-によるクエリスコーピング)
8. [profiles テーブルとアカウント情報](#8-profiles-テーブルとアカウント情報)
9. [resolveIdentity — クロスアカウントのプロフィール同一人物解決](#9-resolveidentity--クロスアカウントのプロフィール同一人物解決)
10. [次に読むべきドキュメント](#10-次に読むべきドキュメント)

---

## 1. 設計思想

### なぜマルチアカウントが必要か

Fediverse では、ユーザーが複数のサーバー（インスタンス）にアカウントを持つことが一般的である。例えば：

- メインアカウント: `@user@mastodon.social`
- サブアカウント: `@user@pleroma.example.com`
- 別用途アカウント: `@photo@pixelfed.example.net`

miyulab-fe はこれらを **単一のブラウザ内 SQLite データベース** で管理し、タイムラインを横断的に表示する。

### データ分離の原則

| 概念 | 分離レベル | 説明 |
|------|-----------|------|
| **投稿コンテンツ** (`posts`) | 共有 | ActivityPub URI (`object_uri`) で重複排除し、全アカウントで1レコード |
| **タイムライン** (`timeline_entries`) | アカウント単位 | `local_account_id` でスコーピング |
| **インタラクション** (`post_interactions`) | アカウント単位 | お気に入り・ブースト等は各アカウントごとに記録 |
| **通知** (`notifications`) | アカウント単位 | 各アカウントの通知は完全に独立 |
| **投稿⇔サーバーID対応** (`post_backend_ids`) | アカウント単位 | 同一投稿でもアカウントごとに異なる `local_id` を持つ |
| **プロフィール** (`profiles`) | 共有 | `canonical_acct` で正規化し、全アカウントで1レコード |

---

## 2. テーブル関係図

```
┌─────────────┐        ┌──────────────────┐
│   servers    │        │    profiles       │
│─────────────│        │──────────────────│
│ id (PK)     │◄───┐   │ id (PK)          │
│ host (UQ)   │    │   │ canonical_acct   │◄─── UNIQUE
│             │    │   │ username          │
│             │    │   │ server_id (FK)───│───┘
└─────────────┘    │   │ actor_uri         │
       ▲           │   └──────────────────┘
       │           │            ▲
       │           │            │ profile_id (FK)
       │           │   ┌────────┴─────────┐
       │           ├──►│  local_accounts   │
       │           │   │──────────────────│
       │           │   │ id (PK)          │
       │  server_id│   │ server_id (FK)───│───┘
       │  (FK)     │   │ backend_url       │
       │           │   │ backend_type      │
       │           │   │ acct              │
       │           │   │ remote_account_id │
       │           │   │ access_token      │
       │           │   │ is_active         │
       │           │   │ display_order     │
       │           │   └──────────────────┘
       │           │            ▲
       │           │            │ local_account_id (FK)
       │           │            │
  ┌────┴───────────┴──┐   ┌────┴────────────────┐   ┌───────────────────┐
  │      posts         │   │ post_backend_ids    │   │ timeline_entries  │
  │────────────────────│   │─────────────────────│   │───────────────────│
  │ id (PK)            │◄──│ post_id (FK)        │   │ id (PK)           │
  │ object_uri (UQ)    │   │ local_account_id(FK)│──►│ local_account_id  │
  │ origin_server_id   │   │ local_id            │   │ timeline_key      │
  │ author_profile_id  │   │ server_id (FK)      │   │ post_id (FK)──────│──►posts
  │ content_html       │   │ UQ(local_account_id,│   │ display_post_id   │
  │ ...                │   │    local_id)         │   │ created_at_ms     │
  └────────────────────┘   │ UQ(post_id,         │   └───────────────────┘
       ▲                   │    local_account_id) │
       │                   └─────────────────────┘
       │
  ┌────┴────────────────┐   ┌───────────────────┐
  │ post_interactions    │   │  notifications     │
  │─────────────────────│   │───────────────────│
  │ id (PK)             │   │ id (PK)           │
  │ post_id (FK)        │   │ local_account_id  │
  │ local_account_id(FK)│   │ local_id           │
  │ is_favourited       │   │ notification_type  │
  │ is_reblogged        │   │ actor_profile_id   │
  │ is_bookmarked       │   │ related_post_id    │
  │ UQ(post_id,         │   │ UQ(local_account_id│
  │    local_account_id)│   │    , local_id)      │
  └─────────────────────┘   └───────────────────┘
```

---

## 3. local_accounts テーブル

**ソース**: `src/util/db/sqlite/schema/tables/accounts.ts`

ユーザーが登録した各 Fediverse アカウントに対応するレコードを保持する。

### カラム構成

| カラム | 型 | 説明 |
|--------|------|------|
| `id` | INTEGER PK | 内部 ID（auto increment） |
| `server_id` | INTEGER FK | `servers` テーブルへの参照（ホスト名を正規化） |
| `backend_url` | TEXT | バックエンドの完全 URL（例: `https://mastodon.social`） |
| `backend_type` | TEXT | バックエンド種別（`mastodon`, `pleroma` 等） |
| `acct` | TEXT | アカウント名（例: `user@mastodon.social`） |
| `remote_account_id` | TEXT | サーバー上でのアカウント ID |
| `access_token` | TEXT | OAuth アクセストークン（nullable） |
| `profile_id` | INTEGER FK | `profiles` テーブルへの参照 |
| `display_order` | INTEGER | UI 上の表示順序 |
| `is_active` | INTEGER | アクティブフラグ（1 = 有効） |
| `created_at` | INTEGER | 作成日時（Unix ms） |
| `updated_at` | INTEGER | 更新日時（Unix ms） |

### UNIQUE 制約

```sql
UNIQUE(server_id, remote_account_id)
```

同一サーバー上の同一アカウントが重複登録されるのを防ぐ。

### OAuth トークン管理

`access_token` カラムにサーバーから発行された OAuth トークンを保存する。このトークンは API 呼び出し（投稿取得、ストリーミング接続等）に使用される。トークンはブラウザ内 SQLite に保存されるため、デバイス単位で管理される。

### アカウント登録の流れ

**ソース**: `src/util/db/sqlite/worker/handlers/accountHandlers.ts`

```
handleEnsureLocalAccount(db, backendUrl, accountJson)
  ├─ extractHost(backendUrl)        → ホスト名抽出
  ├─ ensureServer(db, host)         → servers レコード確保
  ├─ ensureProfile(db, account, serverId) → profiles レコード確保
  └─ INSERT INTO local_accounts ... ON CONFLICT DO UPDATE
```

`ON CONFLICT(server_id, remote_account_id) DO UPDATE` パターンにより、同一アカウントの再認証時にはレコードが更新される。

---

## 4. post_backend_ids によるクロスアカウント投稿参照

**ソース**: `src/util/db/sqlite/schema/tables/posts.ts`

### 問題: 同一投稿の複数表現

Fediverse では、同じ投稿が異なるサーバーから異なる ID で配信される：

| アカウント | サーバー上の投稿 ID (`local_id`) | 内部 `post_id` |
|------------|-------------------------------|-----------------|
| `@user@mastodon.social` | `"109876543210"` | 42 |
| `@user@pleroma.example.com` | `"AeBfCdDg"` | 42（同一投稿） |

`posts` テーブルは投稿コンテンツを1レコードとして保持し、`post_backend_ids` テーブルが各アカウントから見た「ローカル ID」を紐付ける。

### テーブル定義

```sql
CREATE TABLE post_backend_ids (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id           INTEGER NOT NULL,       -- 内部投稿 ID
  local_account_id  INTEGER NOT NULL,       -- どのアカウントから見た ID か
  local_id          TEXT    NOT NULL,       -- サーバー上の投稿 ID
  server_id         INTEGER NOT NULL,       -- サーバー参照
  UNIQUE(local_account_id, local_id),       -- 制約1: アカウントごとに local_id は一意
  UNIQUE(post_id, local_account_id),        -- 制約2: 1投稿に対しアカウントごとに1レコード
  FOREIGN KEY (post_id)          REFERENCES posts(id)          ON DELETE CASCADE,
  FOREIGN KEY (local_account_id) REFERENCES local_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (server_id)        REFERENCES servers(id)
);
```

### 2つの UNIQUE 制約の意味

1. **`UNIQUE(local_account_id, local_id)`**: あるアカウントが持つサーバーローカル ID は一意。同じ `local_id` が2つの投稿に紐づくことはない
2. **`UNIQUE(post_id, local_account_id)`**: ある投稿に対して、1つのアカウントから見たマッピングは1つだけ

### 登録パターン

**ソース**: `src/util/db/sqlite/worker/handlers/statusHandlers.ts`（`upsertSingleStatus` 関数内）

```sql
INSERT OR IGNORE INTO post_backend_ids (post_id, local_account_id, local_id, server_id)
VALUES (?, ?, ?, ?);
```

`INSERT OR IGNORE` を使用するため、既にマッピングが存在する場合は何もしない。

### 逆引き: local_id → post_id

`resolvePostIdInternal` ヘルパーは `local_account_id` + `local_id` から内部 `post_id` を逆引きする。投稿の UPSERT 時に、object_uri で見つからなかった場合のフォールバックとして使用される。

---

## 5. accountResolver — メモリキャッシュによる同期的解決

**ソース**: `src/util/accountResolver.ts`

### 目的

SQL クエリ内で `local_accounts` テーブルを JOIN やサブクエリで参照するのを避け、**メインスレッド側のメモリキャッシュ**から `backend_url → (localAccountId, serverId)` を同期的に解決する。

### アーキテクチャ

```
                 ┌──────────────────┐
                 │  SQLite Worker   │
                 │  local_accounts  │
                 └────────┬─────────┘
                          │ subscribe('local_accounts', ...)
                          ▼
                 ┌──────────────────┐
                 │ accountResolver  │   Map<backendUrl, ResolvedAccount>
                 │ (メモリキャッシュ) │
                 └────────┬─────────┘
                          │ 同期的に返す
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
  resolveLocalAccountId  resolveServerId  resolveBackendUrlFromAccountId
  (backendUrl → id)      (backendUrl → id) (id → backendUrl)
```

### 主要 API

| 関数 | 説明 |
|------|------|
| `initAccountResolver()` | DB から `local_accounts` を読み込みキャッシュを構築。変更購読も登録 |
| `resolveLocalAccountId(backendUrl)` | `backend_url → local_account_id` を同期的に返す |
| `resolveServerId(backendUrl)` | `backend_url → server_id` を同期的に返す |
| `resolveLocalAccountIds(backendUrls)` | 複数 URL を一括解決 |
| `resolveServerIds(backendUrls)` | 複数 URL の server_id を一括解決 |
| `resolveBackendUrlFromAccountId(id)` | `local_account_id → backend_url` の逆引き |
| `refreshAccountResolver()` | DB からキャッシュを再読み込み |
| `subscribeAccountResolver(listener)` | キャッシュ変更の購読（`useSyncExternalStore` 向け） |
| `getSnapshot()` | 現在のキャッシュ Map を返す（`useSyncExternalStore` getSnapshot 向け） |
| `isAccountResolverReady()` | キャッシュが初期化済みかを返す |

### 自動更新メカニズム

```typescript
// initAccountResolver() 内で一度だけ購読登録
subscribe('local_accounts', () => {
  refreshAccountResolver()  // DB から再読み込み
})
```

`local_accounts` テーブルに変更（アカウント追加・削除等）があると、`subscribe` コールバックが発火し、キャッシュが自動的に再構築される。キャッシュは `Map` インスタンスごと置き換わるため、`useSyncExternalStore` の参照比較で変更検知が可能。

### React との統合

```typescript
// useSyncExternalStore で React コンポーネントからキャッシュを購読
const accounts = useSyncExternalStore(
  subscribeAccountResolver,
  getSnapshot,
)
```

---

## 6. object_uri による投稿の重複排除

### ActivityPub URI のユニーク性

ActivityPub では、各投稿に一意の URI が付与される（例: `https://mastodon.social/users/alice/statuses/123`）。miyulab-fe はこの `object_uri` を利用して、異なるアカウント経由で到着した同一投稿を重複排除（deduplication）する。

### posts テーブルの UNIQUE 制約

**ソース**: `src/util/db/sqlite/schema/tables/posts.ts`

```sql
-- 空文字列を除外した条件付きユニークインデックス
CREATE UNIQUE INDEX idx_posts_object_uri ON posts(object_uri) WHERE object_uri != '';
```

`object_uri` が空文字列でない限り、同一 URI の投稿は1レコードしか存在できない。空文字列は、URI が不明な場合（リブログの URI が元投稿と同一の場合など）のフォールバックに使用される。

### UPSERT パターン

**ソース**: `src/util/db/sqlite/worker/handlers/statusHandlers.ts`（`upsertSingleStatus` 関数）

投稿保存時の検索順序：

```
1. URI キャッシュ (uriCache) で検索         ← バルク UPSERT 時の高速パス
2. object_uri で posts テーブルを検索        ← メインの重複排除
3. post_backend_ids で local_id から検索     ← URI がない場合のフォールバック
4. クロスサーバーリブログの重複検出          ← 同一元投稿 + 同一投稿者のリブログ
```

```sql
-- ステップ 2: object_uri による既存投稿の検索
SELECT id, is_reblog FROM posts WHERE object_uri = ?;
```

既存投稿が見つかった場合は `UPDATE`、見つからなかった場合は `INSERT` を行う。

### リブログ固有のロジック

リブログ（ブースト）は特殊なケースがある：

- **元投稿と同一 URI のリブログ**（Pleroma/Misskey）: リブログ行には空の `object_uri` を割り当て、元投稿側が URI を保持する
- **クロスサーバーリブログ**: 同一の元投稿 URI + 同一投稿者の既存リブログを検索してマージする

```sql
-- クロスサーバーリブログの重複検出
SELECT p.id FROM posts p
  JOIN profiles pr ON pr.id = p.author_profile_id
  JOIN servers s ON s.id = pr.server_id
  JOIN posts orig ON orig.id = p.reblog_of_post_id
WHERE p.is_reblog = 1
  AND orig.object_uri = ?
  AND pr.username = ?
  AND (s.host = ? OR pr.actor_uri LIKE ?)
LIMIT 1;
```

---

## 7. local_account_id によるクエリスコーピング

### 原則

アカウント固有のデータ（タイムライン、インタラクション、通知等）を取得するクエリは、**必ず `local_account_id` でフィルタリング**しなければならない。これを怠ると、別アカウントのデータが混入する。

### スコーピングが必要なテーブル

| テーブル | スコーピングカラム | UNIQUE 制約 |
|---------|-------------------|-------------|
| `post_backend_ids` | `local_account_id` | `(local_account_id, local_id)` |
| `post_interactions` | `local_account_id` | `(post_id, local_account_id)` |
| `timeline_entries` | `local_account_id` | `(local_account_id, timeline_key, post_id)` |
| `notifications` | `local_account_id` | `(local_account_id, local_id)` |

### ✅ 正しいクエリパターン

```sql
-- タイムラインの取得: local_account_id でスコーピング
SELECT te.post_id, te.created_at_ms
FROM timeline_entries te
WHERE te.local_account_id = ?
  AND te.timeline_key = ?
ORDER BY te.created_at_ms DESC
LIMIT 20;

-- インタラクション状態の取得: post_id + local_account_id で特定
SELECT is_favourited, is_reblogged, is_bookmarked
FROM post_interactions
WHERE post_id = ? AND local_account_id = ?;

-- 通知の取得: local_account_id でスコーピング
SELECT id, local_id, notification_type_id, created_at_ms
FROM notifications
WHERE local_account_id = ?
  AND is_read = 0
ORDER BY created_at_ms DESC;

-- サーバーローカル ID から内部 post_id を逆引き
SELECT post_id FROM post_backend_ids
WHERE local_account_id = ? AND local_id = ?;
```

### ❌ 間違ったクエリパターン

```sql
-- NG: local_account_id なしでタイムラインを取得
-- → 全アカウントのタイムラインエントリが混在する
SELECT post_id FROM timeline_entries
WHERE timeline_key = 'home'
ORDER BY created_at_ms DESC;

-- NG: local_account_id なしでインタラクション状態を取得
-- → 別アカウントのお気に入り状態が返る可能性がある
SELECT is_favourited FROM post_interactions
WHERE post_id = 42;

-- NG: local_id だけで post_backend_ids を検索
-- → 異なるサーバーで同じ local_id が存在する可能性がある
SELECT post_id FROM post_backend_ids WHERE local_id = '12345';
```

### accountResolver との連携

実際のアプリケーションコードでは、`backend_url` から `local_account_id` を同期的に解決してクエリに渡す：

```typescript
import { resolveLocalAccountId } from 'util/accountResolver'

const localAccountId = resolveLocalAccountId(backendUrl)
// → この localAccountId を WHERE 句に渡す
```

---

## 8. profiles テーブルとアカウント情報

**ソース**: `src/util/db/sqlite/schema/tables/profiles.ts`

### profiles と local_accounts の関係

`profiles` テーブルは Fediverse 上の全ユーザーのプロフィール情報を保持する（ローカルアカウントだけでなく、タイムラインに表示される全ユーザー）。`local_accounts.profile_id` で自分自身のプロフィールと紐付く。

```
local_accounts.profile_id ──FK──► profiles.id
posts.author_profile_id   ──FK──► profiles.id
```

### canonical_acct による正規化

**ソース**: `src/util/db/sqlite/helpers/profile.ts`（`computeCanonicalAcct` 関数）

```typescript
function computeCanonicalAcct(acct: string, host: string): string {
  return acct.includes('@') ? acct : `${acct}@${host}`
}
```

Mastodon API では、ローカルユーザーの `acct` に `@domain` が付かない場合がある（例: `alice` vs `alice@mastodon.social`）。`canonical_acct` はサーバーの `host` を補完して常に FQN（Fully Qualified Name）形式に正規化する。

### UNIQUE 制約

```sql
UNIQUE(canonical_acct)       -- FQN でグローバルに一意
UNIQUE(username, server_id)  -- サーバー内で一意
```

### ensureProfile の UPSERT

```sql
INSERT INTO profiles (...) VALUES (...)
ON CONFLICT(canonical_acct) DO UPDATE SET
  display_name = excluded.display_name, ...
ON CONFLICT(username, server_id) DO UPDATE SET
  canonical_acct = excluded.canonical_acct, ...
```

2段階の `ON CONFLICT` により、`canonical_acct` の一致（最優先）と `username + server_id` の一致（次善）のいずれでも既存レコードを更新する。これにより、異なるアカウント経由で同一ユーザーのプロフィールが到着しても、1レコードに正規化される。

---

## 9. resolveIdentity — クロスアカウントのプロフィール同一人物解決

**ソース**: `src/util/db/query-ir/executor/lookupRelatedExecutor.ts`

### 問題: 同一人物の異なる profile_id

マルチアカウント環境では、同一人物が異なる `profile_id` を持つことがある：

| canonical_acct | profile_id | 経由アカウント |
|---------------|------------|-------------|
| `alice@mastodon.social` | 10 | `@user@mastodon.social` 経由 |
| `alice@mastodon.social` | 25 | `@user@pleroma.example` 経由（actor_uri の差異により別レコード生成）|

### resolveIdentity の仕組み

Query IR の `LookupRelatedNode` において `resolveIdentity: true` が設定された `joinCondition` は、`profiles.canonical_acct` を介して同一人物の全 `profile_id` に展開する。

**ソース**: `src/util/db/query-ir/nodes.ts`

```typescript
type JoinCondition = {
  lookupColumn: string
  inputColumn?: string
  resolve?: { via: string; inputKey: string; matchColumn: string }
  /** profiles.canonical_acct による同一人物解決 */
  resolveIdentity?: boolean
}
```

### SQL 展開パターン

#### JOIN ベース（per-row 相関）の場合

```sql
SELECT lt.id AS id, lt.created_at_ms AS created_at_ms
FROM {lookupTable} lt
  JOIN profiles _p_lt0 ON lt.{lookupColumn} = _p_lt0.id
  JOIN profiles _p_src0 ON _p_lt0.canonical_acct = _p_src0.canonical_acct
  JOIN {sourceTable} src ON src.{inputColumn} = _p_src0.id
WHERE src.id IN (...)
  AND lt.{timeColumn} >= src.{timeColumn}
  ...
```

#### IN ベース（サブクエリ）の場合

```sql
SELECT lt.id AS id, lt.created_at_ms AS created_at_ms
FROM {lookupTable} lt
WHERE lt.{lookupColumn} IN (
  SELECT p2.id FROM profiles p2
  WHERE p2.canonical_acct IN (
    SELECT p1.canonical_acct FROM profiles p1
    WHERE p1.id IN (
      SELECT DISTINCT {inputColumn} FROM {sourceTable}
      WHERE id IN (...)
    )
  )
)
```

いずれの場合も、`canonical_acct` の一致を介して「同一人物の異なる profile_id」を透過的に解決し、クロスアカウントでの関連投稿検索を可能にする。

---

## 10. 次に読むべきドキュメント

- **[`03-data-layer.md`](./03-data-layer.md)** — SQLite データ層の詳細設計（Worker アーキテクチャ、クエリ実行エンジン、変更通知システム）
- **[`../db-table-design.md`](../db-table-design.md)** — DB テーブル設計の全体像
- **[`../timeline/`](../timeline/)** — タイムラインシステム設計（Query IR、フローエディタ）
