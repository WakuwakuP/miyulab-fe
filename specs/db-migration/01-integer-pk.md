# Phase 1: compositeKey → INTEGER PK 移行

## 概要

現在の TEXT 型 `compositeKey`（`"backendUrl:statusId"` 形式）を
INTEGER 型の自動採番主キー `post_id` に置き換える。

全テーブルの FK がこの PK を参照するため、最初に実施する必要がある。

## スキーマバージョン

v6 → **v7**

## 現状の問題

- TEXT PK はインデックスサイズが大きい（URL 文字列 + ID を結合した長い文字列）
- B-tree の比較が文字列比較になり、INTEGER 比較より遅い
- `statuses_backends` の導入で本来不要になった `backendUrl` が PK に残存
- 関連テーブル全てが TEXT の `compositeKey` を FK として持つ

## ゴール

- `statuses` の PK を `post_id INTEGER PRIMARY KEY` に変更
- `object_uri`（ActivityPub URI）を `UNIQUE` 制約で重複排除に利用
- 関連テーブルの FK を全て `post_id INTEGER` に変更
- `notifications` も同様に `notification_id INTEGER PRIMARY KEY` に変更

## 手順

### Step 1: 新テーブルの定義

```sql
-- 投稿本体（新）
CREATE TABLE posts_new (
  post_id           INTEGER PRIMARY KEY,
  object_uri        TEXT NOT NULL DEFAULT '',
  origin_backend_url TEXT NOT NULL,
  created_at_ms     INTEGER NOT NULL,
  stored_at         INTEGER NOT NULL,
  account_acct      TEXT NOT NULL DEFAULT '',
  account_id        TEXT NOT NULL DEFAULT '',
  visibility        TEXT NOT NULL DEFAULT 'public',
  language          TEXT,
  has_media         INTEGER NOT NULL DEFAULT 0,
  media_count       INTEGER NOT NULL DEFAULT 0,
  is_reblog         INTEGER NOT NULL DEFAULT 0,
  reblog_of_id      TEXT,
  reblog_of_uri     TEXT,
  is_sensitive      INTEGER NOT NULL DEFAULT 0,
  has_spoiler       INTEGER NOT NULL DEFAULT 0,
  in_reply_to_id    TEXT,
  favourites_count  INTEGER NOT NULL DEFAULT 0,
  reblogs_count     INTEGER NOT NULL DEFAULT 0,
  replies_count     INTEGER NOT NULL DEFAULT 0,
  json              TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_posts_new_uri ON posts_new(object_uri) WHERE object_uri != '';
```

### Step 2: 既存データの移行

```sql
-- statuses → posts_new へデータコピー（ROWID が post_id になる）
INSERT INTO posts_new (
  object_uri, origin_backend_url, created_at_ms, stored_at,
  account_acct, account_id, visibility, language,
  has_media, media_count, is_reblog, reblog_of_id, reblog_of_uri,
  is_sensitive, has_spoiler, in_reply_to_id,
  favourites_count, reblogs_count, replies_count, json
)
SELECT
  uri, backendUrl, created_at_ms, storedAt,
  account_acct, account_id, visibility, language,
  has_media, media_count, is_reblog, reblog_of_id, reblog_of_uri,
  is_sensitive, has_spoiler, in_reply_to_id,
  favourites_count, reblogs_count, replies_count, json
FROM statuses
ORDER BY created_at_ms ASC;
```

### Step 3: compositeKey → post_id マッピングテーブル作成

```sql
-- 移行中の一時マッピング（バックフィル用）
CREATE TEMP TABLE key_map AS
SELECT s.compositeKey, p.post_id
FROM statuses s
INNER JOIN posts_new p
  ON s.uri = p.object_uri AND s.uri != ''
UNION ALL
SELECT s.compositeKey, p.post_id
FROM statuses s
INNER JOIN posts_new p
  ON s.backendUrl = p.origin_backend_url
  AND s.created_at_ms = p.created_at_ms
  AND s.storedAt = p.stored_at
WHERE s.uri = '';
```

### Step 4: 関連テーブルの移行

各関連テーブルについて、新テーブルを作成し `post_id` FK でデータを移行する。

```sql
-- statuses_timeline_types → post_timeline_types
CREATE TABLE post_timeline_types (
  post_id       INTEGER NOT NULL,
  timelineType  TEXT NOT NULL,
  PRIMARY KEY (post_id, timelineType),
  FOREIGN KEY (post_id) REFERENCES posts_new(post_id) ON DELETE CASCADE
);

INSERT INTO post_timeline_types (post_id, timelineType)
SELECT km.post_id, stt.timelineType
FROM statuses_timeline_types stt
INNER JOIN key_map km ON stt.compositeKey = km.compositeKey;

-- statuses_belonging_tags → post_belonging_tags
CREATE TABLE post_belonging_tags (
  post_id  INTEGER NOT NULL,
  tag      TEXT NOT NULL,
  PRIMARY KEY (post_id, tag),
  FOREIGN KEY (post_id) REFERENCES posts_new(post_id) ON DELETE CASCADE
);

INSERT INTO post_belonging_tags (post_id, tag)
SELECT km.post_id, sbt.tag
FROM statuses_belonging_tags sbt
INNER JOIN key_map km ON sbt.compositeKey = km.compositeKey;

-- statuses_mentions → post_mentions
CREATE TABLE post_mentions (
  post_id  INTEGER NOT NULL,
  acct     TEXT NOT NULL,
  PRIMARY KEY (post_id, acct),
  FOREIGN KEY (post_id) REFERENCES posts_new(post_id) ON DELETE CASCADE
);

INSERT INTO post_mentions (post_id, acct)
SELECT km.post_id, sm.acct
FROM statuses_mentions sm
INNER JOIN key_map km ON sm.compositeKey = km.compositeKey;

-- statuses_backends → post_backends
CREATE TABLE post_backends (
  post_id     INTEGER NOT NULL,
  backendUrl  TEXT NOT NULL,
  local_id    TEXT NOT NULL,
  PRIMARY KEY (backendUrl, local_id),
  FOREIGN KEY (post_id) REFERENCES posts_new(post_id) ON DELETE CASCADE
);

INSERT INTO post_backends (post_id, backendUrl, local_id)
SELECT km.post_id, sb.backendUrl, sb.local_id
FROM statuses_backends sb
INNER JOIN key_map km ON sb.compositeKey = km.compositeKey;

-- statuses_reblogs → post_reblogs
CREATE TABLE post_reblogs (
  post_id         INTEGER PRIMARY KEY,
  original_uri    TEXT NOT NULL DEFAULT '',
  reblogger_acct  TEXT NOT NULL DEFAULT '',
  reblogged_at_ms INTEGER NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts_new(post_id) ON DELETE CASCADE
);

INSERT INTO post_reblogs (post_id, original_uri, reblogger_acct, reblogged_at_ms)
SELECT km.post_id, sr.original_uri, sr.reblogger_acct, sr.reblogged_at_ms
FROM statuses_reblogs sr
INNER JOIN key_map km ON sr.compositeKey = km.compositeKey;
```

### Step 5: マテリアライズドビューの移行

```sql
-- timeline_entries → timeline_entries_new
CREATE TABLE timeline_entries_new (
  post_id          INTEGER NOT NULL,
  timelineType     TEXT NOT NULL,
  backendUrl       TEXT NOT NULL,
  created_at_ms    INTEGER NOT NULL,
  has_media        INTEGER NOT NULL DEFAULT 0,
  media_count      INTEGER NOT NULL DEFAULT 0,
  visibility       TEXT NOT NULL DEFAULT 'public',
  language         TEXT,
  is_reblog        INTEGER NOT NULL DEFAULT 0,
  in_reply_to_id   TEXT,
  has_spoiler      INTEGER NOT NULL DEFAULT 0,
  is_sensitive     INTEGER NOT NULL DEFAULT 0,
  account_acct     TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (timelineType, backendUrl, post_id),
  FOREIGN KEY (post_id) REFERENCES posts_new(post_id) ON DELETE CASCADE
);

-- tag_entries も同様に移行（省略）
```

### Step 6: notifications テーブルの移行

```sql
CREATE TABLE notifications_new (
  notification_id   INTEGER PRIMARY KEY,
  backend_url       TEXT NOT NULL,
  created_at_ms     INTEGER NOT NULL,
  stored_at         INTEGER NOT NULL,
  notification_type TEXT NOT NULL DEFAULT '',
  status_id         TEXT,
  account_acct      TEXT NOT NULL DEFAULT '',
  json              TEXT NOT NULL
);

INSERT INTO notifications_new (
  backend_url, created_at_ms, stored_at,
  notification_type, status_id, account_acct, json
)
SELECT backendUrl, created_at_ms, storedAt,
       notification_type, status_id, account_acct, json
FROM notifications
ORDER BY created_at_ms ASC;
```

### Step 7: 旧テーブルの削除とリネーム

```sql
-- 旧テーブル削除
DROP TABLE IF EXISTS timeline_entries;
DROP TABLE IF EXISTS tag_entries;
DROP TABLE IF EXISTS statuses_reblogs;
DROP TABLE IF EXISTS statuses_backends;
DROP TABLE IF EXISTS statuses_mentions;
DROP TABLE IF EXISTS statuses_belonging_tags;
DROP TABLE IF EXISTS statuses_timeline_types;
DROP TABLE IF EXISTS statuses;
DROP TABLE IF EXISTS notifications;

-- リネーム
ALTER TABLE posts_new RENAME TO posts;
ALTER TABLE post_timeline_types RENAME TO posts_timeline_types;
ALTER TABLE post_belonging_tags RENAME TO posts_belonging_tags;
ALTER TABLE post_mentions RENAME TO posts_mentions;
ALTER TABLE post_backends RENAME TO posts_backends;
ALTER TABLE post_reblogs RENAME TO posts_reblogs;
ALTER TABLE notifications_new RENAME TO notifications;
ALTER TABLE timeline_entries_new RENAME TO timeline_entries;
-- tag_entries_new も同様

-- 一時テーブル削除
DROP TABLE IF EXISTS key_map;
```

### Step 8: インデックス再作成

```sql
-- posts
CREATE INDEX idx_posts_backend_created ON posts(origin_backend_url, created_at_ms DESC);
CREATE INDEX idx_posts_account_acct ON posts(account_acct);
CREATE INDEX idx_posts_created ON posts(created_at_ms DESC);
CREATE INDEX idx_posts_media_filter ON posts(origin_backend_url, has_media, created_at_ms DESC);
CREATE INDEX idx_posts_visibility_filter ON posts(origin_backend_url, visibility, created_at_ms DESC);
CREATE INDEX idx_posts_language_filter ON posts(origin_backend_url, language, created_at_ms DESC);
CREATE INDEX idx_posts_reblog_filter ON posts(origin_backend_url, is_reblog, created_at_ms DESC);
CREATE INDEX idx_posts_reblog_of_uri ON posts(reblog_of_uri);

-- posts_timeline_types
CREATE INDEX idx_ptt_type ON posts_timeline_types(timelineType);
CREATE INDEX idx_ptt_type_key ON posts_timeline_types(timelineType, post_id);

-- posts_belonging_tags
CREATE INDEX idx_pbt_tag ON posts_belonging_tags(tag);
CREATE INDEX idx_pbt_tag_key ON posts_belonging_tags(tag, post_id);

-- posts_mentions
CREATE INDEX idx_pm_acct ON posts_mentions(acct);

-- posts_backends
CREATE INDEX idx_pb_post_id ON posts_backends(post_id);
CREATE INDEX idx_pb_backendUrl ON posts_backends(backendUrl);
CREATE INDEX idx_pb_backend_key ON posts_backends(backendUrl, post_id);

-- posts_reblogs
CREATE INDEX idx_pr_original_uri ON posts_reblogs(original_uri);
CREATE INDEX idx_pr_reblogger_acct ON posts_reblogs(reblogger_acct);

-- notifications
CREATE INDEX idx_notifications_backend ON notifications(backend_url);
CREATE INDEX idx_notifications_backend_created ON notifications(backend_url, created_at_ms DESC);
CREATE INDEX idx_notifications_type ON notifications(notification_type);
CREATE INDEX idx_notifications_status_id ON notifications(backend_url, status_id);
CREATE INDEX idx_notifications_account_acct ON notifications(account_acct);

-- timeline_entries
CREATE INDEX idx_te_cover ON timeline_entries(timelineType, backendUrl, created_at_ms DESC);
```

## アプリケーション層の変更

### 変更が必要なファイル

| ファイル                                               | 変更内容                                       |
| ------------------------------------------------------ | ---------------------------------------------- |
| `src/util/db/sqlite/schema.ts`                         | `SCHEMA_VERSION = 7`、`migrateV6toV7()` 追加   |
| `src/util/db/sqlite/shared.ts`                         | `createCompositeKey` → `resolvePostId` に変更  |
| `src/util/db/sqlite/statusStore.ts`                    | 全クエリの `compositeKey` → `post_id` 書き換え |
| `src/util/db/sqlite/notificationStore.ts`              | `compositeKey` → `notification_id` 書き換え    |
| `src/util/db/sqlite/worker/workerStatusStore.ts`       | 全ハンドラの PK 操作を `post_id` ベースに      |
| `src/util/db/sqlite/worker/workerNotificationStore.ts` | 同上                                           |
| `src/util/db/sqlite/worker/workerCleanup.ts`           | クリーンアップクエリの更新                     |
| `src/util/queryBuilder.ts`                             | クエリ補完定義の更新                           |

### SqliteStoredStatus 型の変更

```typescript
// Before
export interface SqliteStoredStatus extends Entity.Status {
  compositeKey: string;
  backendUrl: string;
  // ...
}

// After
export interface SqliteStoredStatus extends Entity.Status {
  post_id: number;
  backendUrl: string;
  // ...
}
```

### resolvePostId ヘルパー

```typescript
// shared.ts
export function resolvePostId(
  db: DbExec,
  backendUrl: string,
  localId: string,
): number | null {
  const rows = db.exec(
    "SELECT post_id FROM posts_backends WHERE backendUrl = ? AND local_id = ?;",
    { bind: [backendUrl, localId], returnValue: "resultRows" },
  ) as number[][];
  return rows.length > 0 ? rows[0][0] : null;
}
```

## テスト項目

- [ ] フレッシュインストールで v7 スキーマが正しく作成される
- [ ] v6 → v7 マイグレーションでデータが欠損しない
- [ ] `getStatusesByTimelineType` が正常に動作する
- [ ] `getStatusesByTag` が正常に動作する
- [ ] `getStatusesByCustomQuery` が正常に動作する
- [ ] `getNotifications` が正常に動作する
- [ ] `upsertStatus` / `bulkUpsertStatuses` が正常に動作する
- [ ] `handleDeleteEvent` が正常に動作する
- [ ] `enforceMaxLength` が正常に動作する
- [ ] URI ベースの重複排除が維持される
- [ ] `yarn build` が通る
- [ ] `yarn check` が通る

## リスク・注意点

- SQLite の `ALTER TABLE RENAME` は FK を自動更新しない → 新テーブル作成 + データ移行方式を採用
- データ量が多い場合、移行に時間がかかる → トランザクション内で実行し途中失敗時はロールバック
- compositeKey を参照する外部コード（React コンポーネント等）の `key` prop への影響を確認
