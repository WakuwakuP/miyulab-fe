# 03. データストレージ

## 技術選定

### なぜ SQLite (wa-sqlite) か

ブラウザ上で動作するリレーショナルデータベースとして **wa-sqlite**（SQLite の WebAssembly 実装）を採用。

| 選択肢 | 不採用理由 |
|--------|-----------|
| IndexedDB | JOIN やフィルタの表現力不足。マルチバックエンド横断クエリが困難 |
| Dexie.js | 当初採用していたが、複雑なフィルタ条件の組み合わせに限界 → SQLite に移行 |
| メモリ保持 | ページ離脱でデータ消失。大量データのメモリ占有 |

### OPFS 永続化

SQLite データベースは **OPFS SAH Pool VFS**（Origin Private File System - Storage Access Handle Pool Virtual File System）で永続化される。

**初期化のフォールバックチェーン**:

```
1. Dedicated Worker + OPFS SAH Pool VFS  ← 最速・最優先
2. Dedicated Worker + Standard OPFS       ← フォールバック
3. メインスレッド + インメモリDB            ← 最終フォールバック
```

Worker モードでは以下の PRAGMA を設定：

```sql
PRAGMA journal_mode=WAL;      -- 読み書き並行アクセスの性能向上
PRAGMA synchronous=NORMAL;    -- 書き込み性能とデータ安全のバランス
PRAGMA foreign_keys = ON;     -- 外部キー制約の有効化
```

## テーブル設計

### 投稿（posts）

タイムラインシステムの中心テーブル。Mastodon の `Status` エンティティを正規化して格納する。

```sql
posts (
  post_id           INTEGER PRIMARY KEY,  -- 内部ID（自動採番）
  object_uri        TEXT NOT NULL UNIQUE,  -- ActivityPub URI（重複排除キー）
  origin_server_id  INTEGER,              -- 発信元サーバ
  created_at_ms     INTEGER NOT NULL,     -- 投稿日時（ミリ秒UNIX時間）
  stored_at         INTEGER NOT NULL,     -- 格納日時
  author_profile_id INTEGER,              -- 投稿者プロフィール
  visibility_id     INTEGER,              -- 可視性（FK → visibility_types）
  language          TEXT,                 -- 言語コード
  content_html      TEXT,                 -- HTML本文
  spoiler_text      TEXT,                 -- CWテキスト
  canonical_url     TEXT,                 -- 正規URL
  has_media         INTEGER,              -- メディア有無 (0/1)
  media_count       INTEGER,              -- メディア数
  is_reblog         INTEGER,              -- ブーストか (0/1)
  reblog_of_uri     TEXT,                 -- ブースト元URI
  is_sensitive      INTEGER,              -- センシティブか (0/1)
  has_spoiler       INTEGER,              -- CW付きか (0/1)
  in_reply_to_id    TEXT,                 -- リプライ先ID
  edited_at         TEXT                  -- 編集日時
)
```

**設計判断**:
- **`object_uri` に UNIQUE 制約**: ActivityPub の URI は連合上でグローバルに一意。これを主キーの代わりにユニーク制約として使い、複数バックエンドからの重複を排除する。
- **`created_at_ms` をミリ秒整数で保持**: 文字列の日時比較よりインデックス効率が高い。ソートとページネーションの基盤。
- **ブールフィールドの非正規化**: `has_media`, `is_reblog`, `is_sensitive`, `has_spoiler` を直接カラムに持つことで、フィルタクエリで JOIN なしに WHERE 条件を適用できる。

### バックエンド関連（posts_backends）

1 つの投稿が複数のバックエンドから参照される関係を管理。

```sql
posts_backends (
  post_id     INTEGER NOT NULL,
  backendUrl  TEXT NOT NULL,       -- サーバURL
  local_id    TEXT NOT NULL,       -- そのサーバ上でのローカルID
  server_id   INTEGER,            -- FK → servers
  PRIMARY KEY (backendUrl, local_id),
  FOREIGN KEY (post_id) REFERENCES posts(post_id)
)
```

**重複排除の流れ**:
1. 新しい投稿が到着 → `object_uri` で既存レコードを検索
2. 存在すれば → `posts_backends` に新しいバックエンド関連を追加するのみ
3. 存在しなければ → `posts` に INSERT + `posts_backends` に関連追加

### タイムライン管理（timelines / timeline_items）

どの投稿がどのタイムラインに属するかを管理する。

```sql
timelines (
  timeline_id      INTEGER PRIMARY KEY,
  server_id        INTEGER NOT NULL,       -- FK → servers
  channel_kind_id  INTEGER NOT NULL,       -- FK → channel_kinds (home/local/public/tag/notification)
  tag              TEXT,                   -- タグタイムラインの場合のタグ名
  created_at       TEXT NOT NULL,
  UNIQUE (server_id, channel_kind_id, tag)
)

timeline_items (
  timeline_item_id       INTEGER PRIMARY KEY,
  timeline_id            INTEGER NOT NULL,  -- FK → timelines
  timeline_item_kind_id  INTEGER NOT NULL,  -- FK → timeline_item_kinds (post/notification/event)
  post_id                INTEGER,           -- FK → posts（投稿の場合）
  notification_id        INTEGER,           -- FK → notifications（通知の場合）
  sort_key               INTEGER,           -- ソート用キー（created_at_ms）
  inserted_at            TEXT NOT NULL
)
```

**設計判断**: `timeline_items` テーブルを導入することで、1 つの投稿が複数のタイムライン（home かつ local）に属する関係を正規化して表現できる。`sort_key` に `created_at_ms` を使うことでタイムライン表示順のインデックスが効く。

### プロフィール（profiles）

投稿者情報の正規化テーブル。

```sql
profiles (
  profile_id      INTEGER PRIMARY KEY,
  actor_uri       TEXT NOT NULL UNIQUE,  -- ActivityPub Actor URI
  home_server_id  INTEGER,
  acct            TEXT,          -- user@domain 形式
  username        TEXT NOT NULL,
  domain          TEXT,          -- ドメイン（ローカルユーザーは NULL）
  display_name    TEXT,
  avatar_url      TEXT,
  header_url      TEXT,
  locked          INTEGER,       -- 鍵アカウント (0/1)
  bot             INTEGER,       -- Bot (0/1)
  updated_at      TEXT NOT NULL
)

-- サーバ間のアカウント解決
profile_aliases (
  profile_alias_id  INTEGER PRIMARY KEY,
  server_id         INTEGER NOT NULL,
  remote_account_id TEXT NOT NULL,      -- そのサーバ上でのアカウントID
  profile_id        INTEGER NOT NULL,   -- FK → profiles
  UNIQUE (server_id, remote_account_id)
)
```

**設計判断**: 同一人物が異なるサーバから異なるアカウント ID で参照される。`profile_aliases` でサーバごとのリモート ID を `profile_id` に名寄せする。

### 通知（notifications）

```sql
notifications (
  notification_id      INTEGER PRIMARY KEY,
  server_id            INTEGER,
  notification_type_id INTEGER,          -- FK → notification_types
  actor_profile_id     INTEGER,          -- 通知を発生させたユーザー
  related_post_id      INTEGER,          -- 関連する投稿（あれば）
  created_at_ms        INTEGER NOT NULL,
  stored_at            INTEGER NOT NULL,
  local_id             TEXT NOT NULL,
  is_read              INTEGER NOT NULL DEFAULT 0,
  [json]               TEXT NOT NULL     -- 元データのJSONバックアップ
)
```

### マスタテーブル

参照データを管理するルックアップテーブル。

| テーブル | 内容 |
|---------|------|
| `servers` | サーバメタデータ（host, base_url, software_type） |
| `software_types` | mastodon, pleroma, firefish, gotosocial, ... |
| `visibility_types` | public, unlisted, private, direct |
| `notification_types` | follow, mention, reblog, favourite, ... |
| `media_types` | image, video, gifv, audio, unknown |
| `engagement_types` | favourite, reblog, bookmark, reaction |
| `channel_kinds` | home, local, federated, tag, notification, bookmark, ... |
| `timeline_item_kinds` | post, notification, event |

### コンテンツ関連テーブル

| テーブル | 用途 |
|---------|------|
| `post_media` | メディア添付ファイル（URL, blurhash, type） |
| `post_stats` | 統計（リプライ数, ブースト数, お気に入り数） |
| `post_engagements` | ユーザーのアクション（お気に入り, ブースト, ブックマーク） |
| `posts_belonging_tags` | 投稿に付けられたハッシュタグ |
| `posts_mentions` | メンション先アカウント |
| `posts_reblogs` | ブースト関連情報 |
| `hashtags` / `post_hashtags` | ハッシュタグマスタと投稿紐付け |
| `polls` / `poll_options` | 投票データ |
| `link_cards` / `post_links` | リンクカード（OGP） |
| `custom_emojis` / `post_custom_emojis` / `profile_custom_emojis` | カスタム絵文字 |

### フィルタリング関連テーブル

| テーブル | 用途 |
|---------|------|
| `muted_accounts` | ミュートアカウント（backendUrl + acct） |
| `blocked_instances` | ブロックインスタンス |
| `follows` | フォロー関係（followsOnly フィルタ用） |

## Worker 構成

### なぜ Worker を使うか

大量の投稿（初期ロード 40 件 × 複数バックエンド、ストリーミング連続受信）を正規化・INSERT する処理はメインスレッドをブロックしうる。Worker に書き込みを隔離することで UI の応答性を保つ。

### 通信プロトコル

Worker とメインスレッドは RPC パターンで通信する。

```
メインスレッド                    Worker
    │                              │
    │  sendCommand({ type,         │
    │    payload })                 │
    │  ──────────────────────────→  │
    │                              │  トランザクション内で処理
    │                              │  BEGIN → INSERT/UPDATE → COMMIT
    │                              │
    │  ←──────────────────────────  │
    │  { result, changedTables,    │
    │    duration }                 │
    │                              │
    │  notifyChange('posts')       │
    │  ──→ subscribe コールバック    │
```

### 主要コマンド

| コマンド | 用途 |
|---------|------|
| `BulkUpsertStatuses` | API 取得した投稿の一括 upsert |
| `UpsertStatus` | ストリーミングからの単一投稿 upsert |
| `UpdateStatus` | 投稿編集イベント |
| `HandleDeleteEvent` | 投稿削除イベント |
| `UpdateStatusAction` | お気に入り/ブースト/ブックマーク操作 |
| `AddNotification` | 通知の追加 |
| `BulkAddNotifications` | 通知の一括追加 |
| `EnforceMaxLength` | 古いデータの定期クリーンアップ |

### ファイル構成

```
src/util/db/sqlite/
  ├── initSqlite.ts         ← DB初期化（Worker/フォールバック判定）
  ├── connection.ts         ← シングルトン接続 + subscribe/notify
  ├── schema.ts             ← スキーマ定義 + マイグレーション（3800行超）
  ├── protocol.ts           ← RPC プロトコル型定義
  ├── statusStore.ts        ← メインスレッド側の投稿ストア（クエリ + コマンド送信）
  ├── notificationStore.ts  ← メインスレッド側の通知ストア
  ├── cleanup.ts            ← 定期クリーンアップ
  ├── workerClient.ts       ← Worker RPC クライアント
  ├── types.ts              ← DbHandle インターフェース
  ├── shared.ts             ← 共有ユーティリティ
  └── worker/
       ├── sqlite.worker.ts        ← Worker エントリポイント
       ├── workerStatusStore.ts    ← 投稿 upsert のトランザクション実装
       ├── workerNotificationStore.ts ← 通知処理
       ├── workerSchema.ts         ← Worker 内のスキーマ型
       └── workerCleanup.ts        ← クリーンアップ実装
```

## インデックス設計

クエリパフォーマンスのためのインデックス。フィルタで頻繁に使用されるカラムに対して設定。

```sql
-- URI重複排除
CREATE UNIQUE INDEX idx_posts_uri ON posts(object_uri);

-- タイムラインクエリ（バックエンド + 時系列）
CREATE INDEX idx_posts_backend_created ON posts_backends(backendUrl, post_id);

-- フィルタ用
CREATE INDEX idx_posts_media_filter ON posts(has_media, media_count);
CREATE INDEX idx_posts_visibility_filter ON posts(visibility_id);
CREATE INDEX idx_posts_language_filter ON posts(language);
CREATE INDEX idx_posts_reblog_filter ON posts(is_reblog);
```

## 定期クリーンアップ

`cleanup.ts` が `MAX_LENGTH`（デフォルト 100,000 件）を超えた古い投稿を削除する。

- アプリ起動時に即時実行
- 以降 60 分ごとに定期実行
- Worker 内の `enforceMaxLength` コマンドとして実行
