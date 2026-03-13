# Phase 4: 投稿データ正規化（メディア・ハッシュタグ・統計・投票・OGP）

## 概要

JSON blob に埋め込まれている投稿の付随データを正規化テーブルに抽出する。
これにより、メディア検索・統計ソート・投票状態の直接クエリが可能になる。

## スキーマバージョン

v9 → **v10**

## 前提

- Phase 1（INTEGER PK）が完了していること
- Phase 2（マスターテーブル）の `media_types` が存在すること

## 導入するテーブル

### 4-1. `post_media`（添付メディア）

```sql
CREATE TABLE post_media (
  media_id        INTEGER PRIMARY KEY,
  post_id         INTEGER NOT NULL,
  media_type_id   INTEGER NOT NULL,
  remote_media_id TEXT,
  url             TEXT NOT NULL,
  preview_url     TEXT,
  description     TEXT,
  blurhash        TEXT,
  width           INTEGER,
  height          INTEGER,
  duration_ms     INTEGER,
  sort_order      INTEGER NOT NULL,
  is_sensitive    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (post_id, sort_order),
  FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE,
  FOREIGN KEY (media_type_id) REFERENCES media_types(media_type_id)
);

CREATE INDEX idx_post_media_post ON post_media(post_id);
CREATE INDEX idx_post_media_type ON post_media(media_type_id);
```

### 4-2. `hashtags`（ハッシュタグ辞書）

```sql
CREATE TABLE hashtags (
  hashtag_id      INTEGER PRIMARY KEY,
  normalized_name TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL
);
```

### 4-3. `post_hashtags`（投稿 × ハッシュタグ多対多）

```sql
CREATE TABLE post_hashtags (
  post_id    INTEGER NOT NULL,
  hashtag_id INTEGER NOT NULL,
  sort_order INTEGER,
  PRIMARY KEY (post_id, hashtag_id),
  FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE,
  FOREIGN KEY (hashtag_id) REFERENCES hashtags(hashtag_id)
);

CREATE INDEX idx_ph_hashtag ON post_hashtags(hashtag_id, post_id);
```

### 4-4. `post_stats`（投稿統計）

```sql
CREATE TABLE post_stats (
  post_id           INTEGER PRIMARY KEY,
  replies_count     INTEGER,
  reblogs_count     INTEGER,
  favourites_count  INTEGER,
  reactions_count   INTEGER,
  quotes_count      INTEGER,
  fetched_at        TEXT NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
);

CREATE INDEX idx_ps_favourites ON post_stats(favourites_count, post_id);
CREATE INDEX idx_ps_reblogs ON post_stats(reblogs_count, post_id);
```

### 4-5. `custom_emojis`（カスタム絵文字）

```sql
CREATE TABLE custom_emojis (
  emoji_id          INTEGER PRIMARY KEY,
  server_id         INTEGER NOT NULL,
  shortcode         TEXT NOT NULL,
  domain            TEXT,
  image_url         TEXT NOT NULL,
  static_url        TEXT,
  visible_in_picker INTEGER NOT NULL DEFAULT 1,
  UNIQUE (server_id, shortcode),
  FOREIGN KEY (server_id) REFERENCES servers(server_id)
);
```

### 4-6. `polls`（投票）

```sql
CREATE TABLE polls (
  poll_id       INTEGER PRIMARY KEY,
  post_id       INTEGER NOT NULL UNIQUE,
  expires_at    TEXT,
  multiple      INTEGER NOT NULL DEFAULT 0,
  votes_count   INTEGER,
  voters_count  INTEGER,
  FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
);
```

### 4-7. `poll_options`（投票選択肢）

```sql
CREATE TABLE poll_options (
  poll_option_id  INTEGER PRIMARY KEY,
  poll_id         INTEGER NOT NULL,
  option_index    INTEGER NOT NULL,
  title           TEXT NOT NULL,
  votes_count     INTEGER,
  UNIQUE (poll_id, option_index),
  FOREIGN KEY (poll_id) REFERENCES polls(poll_id) ON DELETE CASCADE
);
```

### 4-8. `link_cards`（OGP カード）

```sql
CREATE TABLE link_cards (
  link_card_id  INTEGER PRIMARY KEY,
  canonical_url TEXT NOT NULL UNIQUE,
  title         TEXT,
  description   TEXT,
  image_url     TEXT,
  provider_name TEXT,
  fetched_at    TEXT NOT NULL
);
```

### 4-9. `post_links`（投稿 × リンクカード）

```sql
CREATE TABLE post_links (
  post_id       INTEGER NOT NULL,
  link_card_id  INTEGER NOT NULL,
  url_in_post   TEXT NOT NULL,
  sort_order    INTEGER,
  PRIMARY KEY (post_id, link_card_id, url_in_post),
  FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE,
  FOREIGN KEY (link_card_id) REFERENCES link_cards(link_card_id)
);
```

## 手順

### Step 1: テーブル作成

上記の全テーブルを作成する。

### Step 2: post_media のバックフィル

```sql
-- JSON の media_attachments 配列からメディア情報を抽出
INSERT OR IGNORE INTO post_media (
  post_id, media_type_id, remote_media_id, url, preview_url,
  description, blurhash, sort_order, is_sensitive
)
SELECT
  p.post_id,
  COALESCE(
    (SELECT mt.media_type_id FROM media_types mt
     WHERE mt.code = json_extract(m.value, '$.type')),
    (SELECT mt.media_type_id FROM media_types mt WHERE mt.code = 'unknown')
  ),
  json_extract(m.value, '$.id'),
  json_extract(m.value, '$.url'),
  json_extract(m.value, '$.preview_url'),
  json_extract(m.value, '$.description'),
  json_extract(m.value, '$.blurhash'),
  m.key,  -- 配列インデックスが sort_order
  p.is_sensitive
FROM posts p, json_each(json_extract(p.json, '$.media_attachments')) m
WHERE p.has_media = 1;
```

### Step 3: hashtags / post_hashtags のバックフィル

```sql
-- 既存の posts_belonging_tags からハッシュタグ辞書を生成
INSERT OR IGNORE INTO hashtags (normalized_name, display_name)
SELECT DISTINCT LOWER(tag), tag
FROM posts_belonging_tags;

-- post_hashtags を生成
INSERT OR IGNORE INTO post_hashtags (post_id, hashtag_id)
SELECT pbt.post_id, h.hashtag_id
FROM posts_belonging_tags pbt
INNER JOIN hashtags h ON LOWER(pbt.tag) = h.normalized_name;
```

### Step 4: post_stats のバックフィル

```sql
INSERT OR IGNORE INTO post_stats (
  post_id, replies_count, reblogs_count, favourites_count, fetched_at
)
SELECT
  post_id, replies_count, reblogs_count, favourites_count, datetime('now')
FROM posts;
```

### Step 5: polls のバックフィル

```sql
-- poll がある投稿を検出
INSERT OR IGNORE INTO polls (post_id, expires_at, multiple, votes_count, voters_count)
SELECT
  p.post_id,
  json_extract(p.json, '$.poll.expires_at'),
  COALESCE(json_extract(p.json, '$.poll.multiple'), 0),
  json_extract(p.json, '$.poll.votes_count'),
  json_extract(p.json, '$.poll.voters_count')
FROM posts p
WHERE json_extract(p.json, '$.poll') IS NOT NULL;

-- poll_options
INSERT OR IGNORE INTO poll_options (poll_id, option_index, title, votes_count)
SELECT
  pl.poll_id,
  o.key,
  json_extract(o.value, '$.title'),
  json_extract(o.value, '$.votes_count')
FROM polls pl
INNER JOIN posts p ON pl.post_id = p.post_id,
json_each(json_extract(p.json, '$.poll.options')) o;
```

### Step 6: link_cards のバックフィル

```sql
-- card がある投稿を検出して link_cards を生成
INSERT OR IGNORE INTO link_cards (canonical_url, title, description, image_url, provider_name, fetched_at)
SELECT DISTINCT
  json_extract(p.json, '$.card.url'),
  json_extract(p.json, '$.card.title'),
  json_extract(p.json, '$.card.description'),
  json_extract(p.json, '$.card.image'),
  json_extract(p.json, '$.card.provider_name'),
  datetime('now')
FROM posts p
WHERE json_extract(p.json, '$.card.url') IS NOT NULL
  AND json_extract(p.json, '$.card.url') != '';

-- post_links
INSERT OR IGNORE INTO post_links (post_id, link_card_id, url_in_post, sort_order)
SELECT
  p.post_id,
  lc.link_card_id,
  json_extract(p.json, '$.card.url'),
  0
FROM posts p
INNER JOIN link_cards lc ON lc.canonical_url = json_extract(p.json, '$.card.url')
WHERE json_extract(p.json, '$.card.url') IS NOT NULL;
```

## アプリケーション層の変更

### 変更が必要なファイル

| ファイル               | 変更内容                                                 |
| ---------------------- | -------------------------------------------------------- |
| `schema.ts`            | `SCHEMA_VERSION = 10`、`migrateV9toV10()` 追加           |
| `workerStatusStore.ts` | upsert 時に post_media, post_stats 等の同期追加          |
| `statusStore.ts`       | メディア検索クエリに post_media JOIN を追加可能に        |
| `queryBuilder.ts`      | 補完候補に `pm` (post_media), `ps` (post_stats) 等を追加 |

### upsert 時の post_media 同期

```typescript
// workerStatusStore.ts 内の upsert ハンドラに追加
function syncPostMedia(
  db: DbExec,
  postId: number,
  mediaAttachments: Entity.Attachment[],
  isSensitive: boolean,
  serverId: number,
): void {
  db.exec("DELETE FROM post_media WHERE post_id = ?;", { bind: [postId] });

  for (let i = 0; i < mediaAttachments.length; i++) {
    const media = mediaAttachments[i];
    const mediaTypeId = resolveMediaTypeId(db, media.type);
    db.exec(
      `INSERT INTO post_media (
        post_id, media_type_id, remote_media_id, url, preview_url,
        description, blurhash, sort_order, is_sensitive
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      {
        bind: [
          postId,
          mediaTypeId,
          media.id,
          media.url,
          media.preview_url ?? null,
          media.description ?? null,
          media.blurhash ?? null,
          i,
          isSensitive ? 1 : 0,
        ],
      },
    );
  }
}
```

## テスト項目

- [ ] post_media に既存メディアデータが正しくバックフィルされる
- [ ] hashtags テーブルに重複なくタグが登録される
- [ ] post_hashtags が posts_belonging_tags と一致する
- [ ] post_stats に全投稿の統計が移行される
- [ ] polls / poll_options が正しくバックフィルされる
- [ ] link_cards に重複なく URL が登録される
- [ ] 新規投稿の upsert で post_media が同期される
- [ ] メディア検索（`s.has_media = 1`）の既存動作が維持される
- [ ] `yarn build` / `yarn check` が通る

## 備考

- `posts_belonging_tags` テーブルは `post_hashtags` への移行後、
  Phase 6（マテビュー見直し）で `tag_entries` とともに廃止する
- 統計カラム（`favourites_count` 等）は `post_stats` に移行後、
  Phase 7 で `posts` テーブルから削除する
- custom_emojis のバックフィルは JSON 内に emojis 配列がある場合のみ実施
  （Misskey/Firefish 系のリアクション絵文字向け）
