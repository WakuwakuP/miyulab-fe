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

1. Dedicated Worker + OPFS SAH Pool VFS  ← 最速・最優先
2. Dedicated Worker + Standard OPFS       ← フォールバック
3. メインスレッド + インメモリDB            ← 最終フォールバック

Worker モードでは以下の PRAGMA を設定：

PRAGMA journal_mode=WAL;      -- 読み書き並行アクセスの性能向上
PRAGMA synchronous=NORMAL;    -- 書き込み性能とデータ安全のバランス
PRAGMA foreign_keys = ON;     -- 外部キー制約の有効化

## テーブル設計（v2.0.x スキーマ）

全 30 テーブル（v2.0.0 の 28 テーブル + v2.0.1 の 2 テーブル）。

### 投稿（posts）

タイムラインシステムの中心テーブル。Mastodon の `Status` エンティティを正規化して格納する。

posts (
  id                  INTEGER PRIMARY KEY,  -- 内部ID（自動採番）
  object_uri          TEXT NOT NULL UNIQUE,  -- ActivityPub URI（重複排除キー）
  origin_server_id    INTEGER,              -- 発信元サーバ
  author_profile_id   INTEGER,              -- 投稿者プロフィール（FK → profiles）
  created_at_ms       INTEGER NOT NULL,     -- 投稿日時（ミリ秒UNIX時間）
  visibility_id       INTEGER,              -- 可視性（FK → visibility_types）
  language            TEXT,                 -- 言語コード
  content_html        TEXT,                 -- HTML本文
  plain_content       TEXT,                 -- プレーンテキスト本文
  spoiler_text        TEXT,                 -- CWテキスト
  canonical_url       TEXT,                 -- 正規URL
  is_reblog           INTEGER,              -- ブーストか (0/1)
  is_sensitive        INTEGER,              -- センシティブか (0/1)
  in_reply_to_uri     TEXT,                 -- リプライ先URI
  in_reply_to_account_acct TEXT,            -- リプライ先アカウント
  is_local_only       INTEGER,              -- ローカル限定投稿 (0/1)
  edited_at_ms        INTEGER,              -- 編集日時（ミリ秒）
  reblog_of_post_id   INTEGER,              -- ブースト元投稿（FK → posts）
  quote_of_post_id    INTEGER,              -- 引用元投稿（FK → posts）
  quote_state         TEXT,                 -- 引用状態
  application_name    TEXT,                 -- 投稿アプリ名
  last_fetched_at     INTEGER               -- 最終取得日時
)

**設計判断**:
- **`object_uri` に UNIQUE 制約**: ActivityPub の URI は連合上でグローバルに一意。複数バックエンドからの重複を排除。
- **`created_at_ms` をミリ秒整数で保持**: 文字列の日時比較よりインデックス効率が高い。ソートとページネーションの基盤。
- **メディア関連のカラムを posts テーブルから廃止**: v2 では `post_media` テーブルのサブクエリでフィルタ（`EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)`）。
- **`in_reply_to_uri` を使用**: ID ではなく URI でリプライ先を参照（サーバ横断の一貫性）。

### アカウント管理（local_accounts）

ユーザーが登録した各バックエンドのアカウント情報。`post_backend_ids` や `timeline_entries` の外部キーとして使用。

local_accounts (
  id            INTEGER PRIMARY KEY,
  backend_url   TEXT NOT NULL UNIQUE,  -- サーバURL（例: https://mastodon.social）
  account_id    TEXT,                  -- そのサーバ上のアカウントID
  created_at    TEXT NOT NULL
)

### バックエンド関連（post_backend_ids）

1 つの投稿が複数のバックエンドから参照される関係を管理。旧 `posts_backends` から `local_account_id` 外部キーベースに変更。

post_backend_ids (
  id                INTEGER PRIMARY KEY,
  post_id           INTEGER NOT NULL,       -- FK → posts
  local_account_id  INTEGER NOT NULL,       -- FK → local_accounts
  local_id          TEXT NOT NULL,          -- そのサーバ上でのローカルID
  UNIQUE (local_account_id, local_id)
)

**重複排除の流れ**:
1. 新しい投稿が到着 → `object_uri` で既存レコードを検索
2. 存在すれば → `post_backend_ids` に新しいバックエンド関連を追加するのみ
3. 存在しなければ → `posts` に INSERT + `post_backend_ids` に関連追加

### タイムライン管理（timeline_entries）

どの投稿がどのタイムラインに属するかを管理する。旧 `timelines` + `timeline_items` テーブルを統合した軽量設計。

timeline_entries (
  id                INTEGER PRIMARY KEY,
  post_id           INTEGER NOT NULL,       -- FK → posts
  local_account_id  INTEGER NOT NULL,       -- FK → local_accounts
  timeline_key      TEXT NOT NULL,          -- 'home' | 'local' | 'public' | 'tag:タグ名'
  inserted_at       INTEGER NOT NULL
)

**設計判断**: `timeline_key` にタイムライン種別を直接文字列で保持。マスタテーブルとの JOIN を不要にし、Phase 1 クエリを軽量化。

### プロフィール（profiles）

投稿者情報の正規化テーブル。

profiles (
  id              INTEGER PRIMARY KEY,
  actor_uri       TEXT NOT NULL UNIQUE,  -- ActivityPub Actor URI
  home_server_id  INTEGER,
  acct            TEXT,          -- user@domain 形式
  username        TEXT NOT NULL,
  domain          TEXT,          -- ドメイン（ローカルユーザーは NULL）
  display_name    TEXT,
  avatar_url      TEXT,
  header_url      TEXT,
  is_locked       INTEGER,       -- 鍵アカウント (0/1)
  is_bot          INTEGER,       -- Bot (0/1)
  updated_at      TEXT NOT NULL
)

### 通知（notifications）

notifications (
  id                   INTEGER PRIMARY KEY,
  local_account_id     INTEGER NOT NULL,     -- FK → local_accounts
  notification_type_id INTEGER,              -- FK → notification_types
  actor_profile_id     INTEGER,              -- 通知を発生させたユーザー
  related_post_id      INTEGER,              -- 関連する投稿（あれば）
  created_at_ms        INTEGER NOT NULL,
  local_id             TEXT NOT NULL,
  is_read              INTEGER NOT NULL DEFAULT 0,
  reaction_name        TEXT,                 -- リアクション名（emoji_reaction 用）
  reaction_url         TEXT,                 -- リアクション URL
  [json]               TEXT NOT NULL         -- 元データのJSONバックアップ
)

### ルックアップテーブル

参照データを管理するテーブル。

| テーブル | 内容 |
|---------|------|
| `servers` | サーバメタデータ（host, base_url, software_type） |
| `visibility_types` | public, unlisted, private, direct |
| `notification_types` | follow, mention, reblog, favourite, ... |
| `media_types` | image, video, gifv, audio, unknown |
| `card_types` | link, photo, video, rich |

### レジストリテーブル

| テーブル | 用途 |
|---------|------|
| `custom_emojis` | カスタム絵文字マスタ |
| `hashtags` | ハッシュタグマスタ |

### コンテンツ関連テーブル

| テーブル | 用途 |
|---------|------|
| `post_media` | メディア添付ファイル（URL, blurhash, type, sort_order） |
| `post_stats` | 統計（お気に入り数, ブースト数, リプライ数, emoji_reactions_json） |
| `post_interactions` | ユーザーのアクション（お気に入り, ブースト, ブックマーク） |
| `post_emoji_reactions` | 絵文字リアクション |
| `post_hashtags` | 投稿に付けられたハッシュタグ（FK → hashtags） |
| `post_mentions` | メンション先アカウント |
| `post_custom_emojis` | 投稿のカスタム絵文字 |
| `polls` / `poll_options` / `poll_votes` | 投票データ |
| `link_cards` | リンクカード（OGP） |

### プロフィール関連テーブル

| テーブル | 用途 |
|---------|------|
| `profile_stats` | プロフィール統計 |
| `profile_fields` | プロフィールフィールド |
| `profile_custom_emojis` | プロフィールのカスタム絵文字 |

### フィルタリング関連テーブル（v2.0.1 追加）

| テーブル | 用途 |
|---------|------|
| `muted_accounts` | ミュートアカウント（backendUrl + acct） |
| `blocked_instances` | ブロックインスタンス |

### メタテーブル

| テーブル | 用途 |
|---------|------|
| `schema_version` | スキーマバージョン履歴 |

## Worker 構成

### なぜ Worker を使うか

大量の投稿（初期ロード 40 件 × 複数バックエンド、ストリーミング連続受信）を正規化・INSERT する処理はメインスレッドをブロックしうる。Worker に書き込みを隔離することで UI の応答性を保つ。

### マイクロバッチ書き込み

ストリーミングイベントは `stores/statusStore.ts` のマイクロバッチシステムで蓄積される。

- **バッチキー**: `backendUrl + timelineType + tag` の組み合わせ
- **フラッシュ条件**: 100ms 経過 **または** 20 件蓄積
- **効果**: 個別 upsert の Worker RPC オーバーヘッドを削減し、トランザクション内で一括処理

### 優先度キューシステム

`dbQueue.ts` が 2 つのキューを管理する。

| キュー | 用途 | 優先度 |
|-------|------|--------|
| `timeline` | タイムライン読み取りクエリ | 低（重複排除あり） |
| `other` | 書き込み・管理操作 | 高 |

**アダプティブモード**（`auto`）: キューサイズの比率に基づいて、連続して other キューから処理する最大数を動的に調整。

### 通信プロトコル

Worker とメインスレッドは RPC パターンで通信する。

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
    │    changeHints, duration }    │
    │                              │
    │  notifyChange('posts',       │
    │    { timelineType, backendUrl })
    │  ──→ subscribe コールバック    │
    │      (80ms デバウンスで集約)    │

### ファイル構成

src/util/db/
  ├── dbQueue.ts              ← 優先度キューシステム
  ├── errors.ts               ← エラーラッパー
  └── sqlite/
       ├── initSqlite.ts         ← DB初期化（Worker/フォールバック判定）
       ├── connection.ts         ← シングルトン接続 + subscribe/notify (80ms debounce)
       ├── protocol.ts           ← RPC プロトコル型定義
       ├── statusStore.ts        ← メインスレッド側の投稿ストア（バレルエクスポート）
       ├── notificationStore.ts  ← メインスレッド側の通知ストア
       ├── cleanup.ts            ← 定期クリーンアップ
       ├── workerClient.ts       ← Worker RPC クライアント
       ├── types.ts              ← DbHandle インターフェース
       ├── shared.ts             ← 共有ユーティリティ
       ├── schema/
       │    ├── index.ts         ← ensureSchema / createFreshSchema
       │    ├── version.ts       ← SemVer 管理 (LATEST_VERSION = 2.0.1)
       │    ├── types.ts         ← DbExec 型
       │    └── tables/          ← テーブル別 CREATE 文
       │         ├── accounts.ts, cards.ts, interactions.ts,
       │         ├── lookup.ts, meta.ts, notifications.ts,
       │         ├── polls.ts, postRelated.ts, posts.ts,
       │         ├── profiles.ts, registries.ts, timeline.ts
       ├── migrations/
       │    ├── index.ts         ← マイグレーションランナー
       │    ├── types.ts         ← Migration 型
       │    ├── helpers.ts       ← ヘルパー（tableExists, recreateTable 等）
       │    ├── v28.ts           ← レガシーバージョン
       │    ├── v2.0.0/          ← v2.0.0 マイグレーション（全テーブル再作成）
       │    └── v2.0.1/          ← v2.0.1 マイグレーション（muted/blocked 追加）
       ├── queries/
       │    ├── statusFilter.ts  ← フィルタ条件生成
       │    ├── statusFetch.ts   ← fetchTimeline バッチ API
       │    ├── statusBatch.ts   ← バッチクエリテンプレート
       │    ├── statusSelect.ts  ← SELECT 句定義
       │    ├── statusMapper.ts  ← 行データ → オブジェクト変換
       │    └── statusCustomQuery.ts ← カスタムクエリ用
       ├── stores/
       │    ├── statusStore.ts   ← 投稿 upsert（マイクロバッチ）
       │    └── statusReadStore.ts ← 読み取り専用
       ├── helpers/              ← ユーティリティ関数
       └── worker/
            ├── sqlite.worker.ts        ← Worker エントリポイント
            ├── workerStatusStore.ts    ← 投稿 upsert のトランザクション実装
            ├── workerNotificationStore.ts ← 通知処理
            ├── workerSchema.ts         ← Worker 内のスキーマ型
            ├── workerCleanup.ts        ← クリーンアップ実装
            └── handlers/               ← Worker ハンドラ
                 ├── statusHandlers.ts, statusHelpers.ts,
                 ├── statusUpdateHandler.ts, accountHandlers.ts,
                 ├── interactionHandlers.ts, timelineHandlers.ts,
                 ├── postSync.ts, types.ts

## 定期クリーンアップ

`cleanup.ts` がデータベースの肥大化を防ぐ。

- アプリ起動時に即時実行
- 以降定期的に実行
- Worker 内の `enforceMaxLength` コマンドとして実行
