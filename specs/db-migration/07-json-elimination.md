# Phase 7: JSON blob 廃止

## 概要

Phase 1〜6 で正規化テーブルへの移行が完了した後、
`posts.json` / `notifications.json` カラムを廃止し、
アプリケーション層を完全に正規化テーブルからの読み取りに切り替える。

## スキーマバージョン

v12 → **v13**

## 前提

- Phase 1〜6 が全て完了していること
- 特に以下が必須:
  - Phase 3: プロフィール正規化（account 情報の独立管理）
  - Phase 4: post_media / post_stats 等（JSON 内データの全抽出）
  - Phase 5: post_engagements（アクション状態の独立管理）

## 現状の問題

- `json TEXT NOT NULL` カラムが投稿本体の全データを文字列として保持
- 正規化カラムと JSON で同じ情報を二重保持（ストレージの無駄）
- 読み取り時に `JSON.parse()` でデシリアライズ（CPU コスト）
- JSON 内のデータ更新が「パース → 書き換え → 再格納」の高コスト処理

## ゴール

- `posts` テーブルから `json` カラムを削除
- `notifications` テーブルから `json` カラムを削除
- `SqliteStoredStatus` / `SqliteStoredNotification` を正規化カラムから組み立てる
- 移行期の互換カラム（`origin_backend_url`, `account_acct` 等）も整理

## 手順

### Step 1: posts テーブルにまだ不足しているカラムの追加

JSON 廃止に向け、まだ正規化カラムとして存在しないデータがあれば追加する。

```sql
-- content_html（投稿本文）
ALTER TABLE posts ADD COLUMN content_html TEXT;

-- spoiler_text（CW テキスト）
ALTER TABLE posts ADD COLUMN spoiler_text TEXT;

-- is_local_only（ローカル限定投稿フラグ）
ALTER TABLE posts ADD COLUMN is_local_only INTEGER NOT NULL DEFAULT 0;

-- edited_at（編集日時）
ALTER TABLE posts ADD COLUMN edited_at TEXT;

-- url（投稿の公開 URL）
ALTER TABLE posts ADD COLUMN canonical_url TEXT;
```

### Step 2: 新カラムへのバックフィル

```sql
UPDATE posts SET
  content_html  = json_extract(json, '$.content'),
  spoiler_text  = json_extract(json, '$.spoiler_text'),
  edited_at     = json_extract(json, '$.edited_at'),
  canonical_url = json_extract(json, '$.url');
```

### Step 3: notifications テーブルに不足カラムの追加

```sql
-- post_id FK (Phase 1 の post_id を参照)
ALTER TABLE notifications ADD COLUMN related_post_id INTEGER
  REFERENCES posts(post_id);

-- notifications の post_id をバックフィル
UPDATE notifications SET related_post_id = (
  SELECT pb.post_id FROM posts_backends pb
  WHERE pb.backendUrl = notifications.backend_url
    AND pb.local_id = notifications.status_id
) WHERE status_id IS NOT NULL;
```

### Step 4: json カラムの廃止

SQLite は `ALTER TABLE DROP COLUMN` をサポートしているが（3.35.0 以降）、
安全のためテーブル再構築方式を採用する。

```sql
-- posts の再構築
CREATE TABLE posts_v13 (
  post_id           INTEGER PRIMARY KEY,
  object_uri        TEXT NOT NULL DEFAULT '',
  origin_server_id  INTEGER,
  author_profile_id INTEGER,
  created_at_ms     INTEGER NOT NULL,
  stored_at         INTEGER NOT NULL,
  visibility_id     INTEGER,
  language          TEXT,
  content_html      TEXT,
  spoiler_text      TEXT,
  canonical_url     TEXT,
  has_media         INTEGER NOT NULL DEFAULT 0,
  media_count       INTEGER NOT NULL DEFAULT 0,
  is_reblog         INTEGER NOT NULL DEFAULT 0,
  reblog_of_uri     TEXT,
  is_sensitive      INTEGER NOT NULL DEFAULT 0,
  has_spoiler       INTEGER NOT NULL DEFAULT 0,
  in_reply_to_id    TEXT,
  is_local_only     INTEGER NOT NULL DEFAULT 0,
  edited_at         TEXT,
  FOREIGN KEY (origin_server_id) REFERENCES servers(server_id),
  FOREIGN KEY (author_profile_id) REFERENCES profiles(profile_id),
  FOREIGN KEY (visibility_id) REFERENCES visibility_types(visibility_id)
);

INSERT INTO posts_v13
SELECT
  post_id, object_uri, origin_server_id, author_profile_id,
  created_at_ms, stored_at, visibility_id, language,
  content_html, spoiler_text, canonical_url,
  has_media, media_count, is_reblog, reblog_of_uri,
  is_sensitive, has_spoiler, in_reply_to_id, is_local_only, edited_at
FROM posts;
```

同様に `notifications` テーブルも再構築する。

```sql
CREATE TABLE notifications_v13 (
  notification_id      INTEGER PRIMARY KEY,
  server_id            INTEGER,
  notification_type_id INTEGER,
  actor_profile_id     INTEGER,
  related_post_id      INTEGER,
  created_at_ms        INTEGER NOT NULL,
  stored_at            INTEGER NOT NULL,
  is_read              INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (server_id) REFERENCES servers(server_id),
  FOREIGN KEY (notification_type_id) REFERENCES notification_types(notification_type_id),
  FOREIGN KEY (actor_profile_id) REFERENCES profiles(profile_id),
  FOREIGN KEY (related_post_id) REFERENCES posts_v13(post_id)
);

INSERT INTO notifications_v13
SELECT
  notification_id, server_id, notification_type_id, actor_profile_id,
  related_post_id, created_at_ms, stored_at, 0
FROM notifications;
```

### Step 5: テーブル置き換え

```sql
DROP TABLE posts;
ALTER TABLE posts_v13 RENAME TO posts;

DROP TABLE notifications;
ALTER TABLE notifications_v13 RENAME TO notifications;
```

### Step 6: インデックス再作成

```sql
CREATE UNIQUE INDEX idx_posts_uri ON posts(object_uri) WHERE object_uri != '';
CREATE INDEX idx_posts_created ON posts(created_at_ms DESC);
CREATE INDEX idx_posts_author ON posts(author_profile_id, created_at_ms DESC);
CREATE INDEX idx_posts_server ON posts(origin_server_id, created_at_ms DESC);
CREATE INDEX idx_posts_visibility ON posts(visibility_id, created_at_ms DESC);
CREATE INDEX idx_posts_language ON posts(language, created_at_ms DESC);

CREATE INDEX idx_notifications_created ON notifications(created_at_ms DESC);
CREATE INDEX idx_notifications_type ON notifications(notification_type_id, created_at_ms DESC);
CREATE INDEX idx_notifications_actor ON notifications(actor_profile_id, created_at_ms DESC);
```

### Step 7: 不要テーブルの削除

Phase 4 で `post_hashtags` が導入済みなら、旧テーブルを削除:

```sql
DROP TABLE IF EXISTS posts_belonging_tags;
```

## アプリケーション層の変更（大規模）

### Entity 組み立て関数の新設

JSON パースの代わりに、正規化テーブルから `Entity.Status` を組み立てる関数を作成する。

```typescript
// statusStore.ts に追加
function buildEntityStatus(
  post: PostRow,
  account: ProfileRow,
  media: MediaRow[],
  mentions: MentionRow[],
  tags: HashtagRow[],
  stats: StatsRow | null,
  engagements: EngagementRow[],
  card: LinkCardRow | null,
  poll: PollRow | null,
): Entity.Status {
  return {
    id: String(post.post_id),
    uri: post.object_uri,
    url: post.canonical_url ?? null,
    content: post.content_html ?? "",
    spoiler_text: post.spoiler_text ?? "",
    visibility: resolveVisibilityCode(post.visibility_id),
    language: post.language,
    sensitive: post.is_sensitive === 1,
    created_at: new Date(post.created_at_ms).toISOString(),
    edited_at: post.edited_at,
    account: buildEntityAccount(account),
    media_attachments: media.map(buildEntityAttachment),
    mentions: mentions.map(buildEntityMention),
    tags: tags.map(buildEntityTag),
    favourites_count: stats?.favourites_count ?? 0,
    reblogs_count: stats?.reblogs_count ?? 0,
    replies_count: stats?.replies_count ?? 0,
    favourited: engagements.some((e) => e.code === "favourite"),
    reblogged: engagements.some((e) => e.code === "reblog"),
    bookmarked: engagements.some((e) => e.code === "bookmark"),
    card: card ? buildEntityCard(card) : null,
    poll: poll ? buildEntityPoll(poll) : null,
    reblog: null, // reblog 元は別途取得
    in_reply_to_id: post.in_reply_to_id,
    // ...
  };
}
```

### 変更が必要なファイル

| ファイル                     | 変更内容                                                         |
| ---------------------------- | ---------------------------------------------------------------- |
| `schema.ts`                  | `SCHEMA_VERSION = 13`、テーブル再構築マイグレーション            |
| `statusStore.ts`             | `rowToStoredStatus` を正規化テーブルからの組み立てに全面書き換え |
| `notificationStore.ts`       | `rowToStoredNotification` を同様に書き換え                       |
| `workerStatusStore.ts`       | 全ハンドラから JSON 文字列操作を削除                             |
| `workerNotificationStore.ts` | 同上                                                             |
| `shared.ts`                  | `extractStatusColumns` / `extractNotificationColumns` を削除     |
| `queryBuilder.ts`            | `s.json` 参照、`json_extract` 関連を削除                         |
| `statusStore.ts` の型定義    | `SqliteStoredStatus` から json 依存を排除                        |

### 削除されるカラム

| テーブル        | 削除カラム                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `posts`         | `json`, `origin_backend_url`, `account_acct`, `account_id`, `visibility`, `reblog_of_id`, `favourites_count`, `reblogs_count`, `replies_count` |
| `notifications` | `json`, `backend_url`, `notification_type`, `status_id`, `account_acct`                                                                        |

## テスト項目

- [ ] posts テーブルから json カラムが削除されている
- [ ] notifications テーブルから json カラムが削除されている
- [ ] `buildEntityStatus` が正しい `Entity.Status` を組み立てる
- [ ] `buildEntityNotification` が正しい `Entity.Notification` を組み立てる
- [ ] タイムライン表示が正常に動作する
- [ ] 通知一覧が正常に動作する
- [ ] 投稿の upsert が JSON なしで正常に動作する
- [ ] カスタムクエリが正常に動作する
- [ ] json_extract を使うカスタムクエリ例がエラーにならない（非推奨の旨を通知）
- [ ] `yarn build` / `yarn check` が通る

## リスク・注意点

- **最も影響範囲が大きいフェーズ**。アプリケーション全体のデータフローに影響
- React コンポーネントが `Entity.Status` の特定フィールドに依存している箇所を事前に洗い出す
- reblog の入れ子構造（`status.reblog`）の組み立てに注意が必要
- カスタムクエリで `json_extract` を使っているユーザーへの影響
  → 移行ガイドまたは互換レイヤーを提供
- 十分な E2E テストを推奨
