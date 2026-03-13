# Phase 2: サーバー・マスターテーブル導入

## 概要

`backendUrl` (TEXT) を `server_id` (INTEGER FK) に置き換えるための `servers` テーブルと、
列挙値を管理するマスターテーブル群を導入する。

## スキーマバージョン

v7 → **v8**

## 前提

- Phase 1（INTEGER PK 移行）が完了していること

## 導入するテーブル

### 2-1. `software_types`（サーバーソフトウェア種別マスター）

```sql
CREATE TABLE software_types (
  software_type_id  INTEGER PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  display_name      TEXT NOT NULL
);

-- 初期データ
INSERT INTO software_types (code, display_name) VALUES
  ('mastodon', 'Mastodon'),
  ('pleroma', 'Pleroma'),
  ('misskey', 'Misskey'),
  ('firefish', 'Firefish'),
  ('akkoma', 'Akkoma'),
  ('gotosocial', 'GoToSocial'),
  ('unknown', 'Unknown');
```

### 2-2. `servers`

```sql
CREATE TABLE servers (
  server_id         INTEGER PRIMARY KEY,
  host              TEXT NOT NULL UNIQUE,
  base_url          TEXT NOT NULL,
  software_type_id  INTEGER,
  software_version  TEXT,
  detected_at       TEXT,
  FOREIGN KEY (software_type_id) REFERENCES software_types(software_type_id)
);

CREATE INDEX idx_servers_host ON servers(host);
```

### 2-3. `visibility_types`

```sql
CREATE TABLE visibility_types (
  visibility_id  INTEGER PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  display_name   TEXT NOT NULL
);

INSERT INTO visibility_types (code, display_name) VALUES
  ('public', '公開'),
  ('unlisted', '未収載'),
  ('private', 'フォロワー限定'),
  ('direct', 'ダイレクト');
```

### 2-4. `notification_types`

```sql
CREATE TABLE notification_types (
  notification_type_id  INTEGER PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE,
  display_name          TEXT NOT NULL
);

INSERT INTO notification_types (code, display_name) VALUES
  ('follow', 'フォロー'),
  ('follow_request', 'フォローリクエスト'),
  ('mention', 'メンション'),
  ('reblog', 'ブースト'),
  ('favourite', 'お気に入り'),
  ('reaction', 'リアクション'),
  ('poll_expired', '投票終了'),
  ('status', '投稿');
```

### 2-5. `media_types`

```sql
CREATE TABLE media_types (
  media_type_id  INTEGER PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  display_name   TEXT NOT NULL
);

INSERT INTO media_types (code, display_name) VALUES
  ('image', '画像'),
  ('video', '動画'),
  ('gifv', 'GIF動画'),
  ('audio', '音声'),
  ('unknown', '不明');
```

### 2-6. `engagement_types`

```sql
CREATE TABLE engagement_types (
  engagement_type_id  INTEGER PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,
  display_name        TEXT NOT NULL
);

INSERT INTO engagement_types (code, display_name) VALUES
  ('favourite', 'お気に入り'),
  ('reblog', 'ブースト'),
  ('bookmark', 'ブックマーク'),
  ('reaction', 'リアクション');
```

### 2-7. `channel_kinds`

```sql
CREATE TABLE channel_kinds (
  channel_kind_id  INTEGER PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  display_name     TEXT NOT NULL
);

INSERT INTO channel_kinds (code, display_name) VALUES
  ('home', 'ホーム'),
  ('local', 'ローカル'),
  ('federated', '連合'),
  ('tag', 'タグ'),
  ('notification', '通知'),
  ('bookmark', 'ブックマーク'),
  ('conversation', 'DM');
```

### 2-8. `timeline_item_kinds`

```sql
CREATE TABLE timeline_item_kinds (
  timeline_item_kind_id  INTEGER PRIMARY KEY,
  code                   TEXT NOT NULL UNIQUE,
  display_name           TEXT NOT NULL
);

INSERT INTO timeline_item_kinds (code, display_name) VALUES
  ('post', '投稿'),
  ('notification', '通知'),
  ('event', 'イベント');
```

## 手順

### Step 1: マスターテーブル作成と初期データ投入

上記の全テーブルを作成し、初期データを INSERT する。

### Step 2: servers テーブルへの既存データ移行

```sql
-- 既存の backendUrl から servers レコードを生成
-- backendUrl の形式: "https://example.com" → host: "example.com"
INSERT OR IGNORE INTO servers (host, base_url)
SELECT DISTINCT
  REPLACE(REPLACE(origin_backend_url, 'https://', ''), 'http://', '') AS host,
  origin_backend_url AS base_url
FROM posts;

-- notifications からも收集
INSERT OR IGNORE INTO servers (host, base_url)
SELECT DISTINCT
  REPLACE(REPLACE(backend_url, 'https://', ''), 'http://', '') AS host,
  backend_url AS base_url
FROM notifications;
```

### Step 3: posts テーブルに server_id カラム追加

```sql
ALTER TABLE posts ADD COLUMN origin_server_id INTEGER REFERENCES servers(server_id);

UPDATE posts SET origin_server_id = (
  SELECT s.server_id FROM servers s WHERE s.base_url = posts.origin_backend_url
);
```

> **注意**: この段階では `origin_backend_url` は残す（Phase 7 で JSON 廃止時にまとめて削除）。

### Step 4: posts_backends テーブルに server_id カラム追加

```sql
ALTER TABLE posts_backends ADD COLUMN server_id INTEGER REFERENCES servers(server_id);

UPDATE posts_backends SET server_id = (
  SELECT s.server_id FROM servers s WHERE s.base_url = posts_backends.backendUrl
);
```

### Step 5: notifications テーブルに server_id カラム追加

```sql
ALTER TABLE notifications ADD COLUMN server_id INTEGER REFERENCES servers(server_id);

UPDATE notifications SET server_id = (
  SELECT s.server_id FROM servers s WHERE s.base_url = notifications.backend_url
);
```

### Step 6: visibility_id カラム追加（posts）

```sql
ALTER TABLE posts ADD COLUMN visibility_id INTEGER REFERENCES visibility_types(visibility_id);

UPDATE posts SET visibility_id = (
  SELECT v.visibility_id FROM visibility_types v WHERE v.code = posts.visibility
);
```

### Step 7: notification_type_id カラム追加（notifications）

```sql
ALTER TABLE notifications ADD COLUMN notification_type_id INTEGER
  REFERENCES notification_types(notification_type_id);

UPDATE notifications SET notification_type_id = (
  SELECT nt.notification_type_id FROM notification_types nt
  WHERE nt.code = notifications.notification_type
);
```

## アプリケーション層の変更

### 変更が必要なファイル

| ファイル                     | 変更内容                                             |
| ---------------------------- | ---------------------------------------------------- |
| `schema.ts`                  | `SCHEMA_VERSION = 8`、`migrateV7toV8()` 追加         |
| `shared.ts`                  | `resolveServerId(backendUrl)` ヘルパー追加           |
| `workerStatusStore.ts`       | upsert 時に `servers` への UPSERT を追加             |
| `workerNotificationStore.ts` | 同上                                                 |
| `statusStore.ts`             | 読み取りクエリは当面 TEXT カラムも参照可（段階移行） |
| `queryBuilder.ts`            | 補完候補に新カラムを追加                             |

### ヘルパー関数

```typescript
// shared.ts に追加
export function ensureServer(db: DbExec, backendUrl: string): number {
  // URL からホスト名を抽出
  const host = new URL(backendUrl).host;

  db.exec(`INSERT OR IGNORE INTO servers (host, base_url) VALUES (?, ?);`, {
    bind: [host, backendUrl],
  });

  const rows = db.exec("SELECT server_id FROM servers WHERE base_url = ?;", {
    bind: [backendUrl],
    returnValue: "resultRows",
  }) as number[][];

  return rows[0][0];
}
```

## テスト項目

- [ ] マスターテーブルの初期データが正しく投入される
- [ ] 既存の backendUrl が servers テーブルに正しく移行される
- [ ] `origin_server_id` が正しくバックフィルされる
- [ ] `visibility_id` が正しくバックフィルされる
- [ ] `notification_type_id` が正しくバックフィルされる
- [ ] 新規投稿の upsert 時に servers レコードが自動作成される
- [ ] 既存のクエリ API が壊れない（TEXT カラムはまだ残存）
- [ ] `yarn build` / `yarn check` が通る

## 備考

- TEXT カラム（`origin_backend_url`, `visibility`, `notification_type` 等）は
  Phase 7（JSON 廃止）のタイミングでまとめて削除する
- マスターテーブルの初期データは今後のサーバーソフトウェア追加に対応できるよう、
  アプリケーション起動時に不足分を自動追加する仕組みも検討する
