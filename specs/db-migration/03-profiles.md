# Phase 3: プロフィール正規化

## 概要

投稿者情報を `account_acct` (TEXT) から正規化された `profiles` テーブルに移行し、
ログインアカウントを管理する `local_accounts` テーブルを導入する。

## スキーマバージョン

v8 → **v9**

## 前提

- Phase 2（servers・マスターテーブル）が完了していること

## 導入するテーブル

### 3-1. `profiles`（canonical ユーザープロフィール）

```sql
CREATE TABLE profiles (
  profile_id      INTEGER PRIMARY KEY,
  actor_uri       TEXT NOT NULL UNIQUE,
  home_server_id  INTEGER,
  acct            TEXT,
  username        TEXT NOT NULL,
  domain          TEXT,
  display_name    TEXT,
  note_html       TEXT,
  avatar_url      TEXT,
  header_url      TEXT,
  locked          INTEGER NOT NULL DEFAULT 0,
  bot             INTEGER NOT NULL DEFAULT 0,
  discoverable    INTEGER,
  created_at      TEXT,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (home_server_id) REFERENCES servers(server_id)
);

CREATE INDEX idx_profiles_acct ON profiles(acct);
CREATE INDEX idx_profiles_server ON profiles(home_server_id, profile_id);
CREATE INDEX idx_profiles_username ON profiles(username);
```

### 3-2. `profile_aliases`（サーバーごとの account ID マッピング）

```sql
CREATE TABLE profile_aliases (
  profile_alias_id  INTEGER PRIMARY KEY,
  server_id         INTEGER NOT NULL,
  remote_account_id TEXT NOT NULL,
  profile_id        INTEGER NOT NULL,
  fetched_at        TEXT NOT NULL,
  UNIQUE (server_id, remote_account_id),
  FOREIGN KEY (server_id) REFERENCES servers(server_id),
  FOREIGN KEY (profile_id) REFERENCES profiles(profile_id)
);

CREATE INDEX idx_pa_profile ON profile_aliases(profile_id);
```

### 3-3. `profile_fields`（プロフィール拡張項目）

```sql
CREATE TABLE profile_fields (
  profile_field_id  INTEGER PRIMARY KEY,
  profile_id        INTEGER NOT NULL,
  field_name        TEXT NOT NULL,
  field_value       TEXT NOT NULL,
  verified_at       TEXT,
  sort_order        INTEGER NOT NULL,
  UNIQUE (profile_id, sort_order),
  FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE
);
```

### 3-4. `local_accounts`（ログイン済みアカウント）

```sql
CREATE TABLE local_accounts (
  local_account_id        INTEGER PRIMARY KEY,
  server_id               INTEGER NOT NULL,
  profile_id              INTEGER NOT NULL,
  is_default_post_account INTEGER NOT NULL DEFAULT 0,
  last_authenticated_at   TEXT,
  UNIQUE (server_id, profile_id),
  FOREIGN KEY (server_id) REFERENCES servers(server_id),
  FOREIGN KEY (profile_id) REFERENCES profiles(profile_id)
);
```

## 手順

### Step 1: テーブル作成

上記 4 テーブルを作成する。

### Step 2: 既存データからプロフィールを抽出

```sql
-- posts の JSON から account 情報を抽出してプロフィールを生成
-- actor_uri は account.url を使用（ActivityPub actor URI 相当）
INSERT OR IGNORE INTO profiles (
  actor_uri, acct, username, domain, display_name,
  avatar_url, header_url, locked, bot, updated_at
)
SELECT DISTINCT
  json_extract(json, '$.account.url') AS actor_uri,
  json_extract(json, '$.account.acct') AS acct,
  json_extract(json, '$.account.username') AS username,
  CASE
    WHEN INSTR(json_extract(json, '$.account.acct'), '@') > 0
    THEN SUBSTR(json_extract(json, '$.account.acct'),
                INSTR(json_extract(json, '$.account.acct'), '@') + 1)
    ELSE NULL
  END AS domain,
  json_extract(json, '$.account.display_name') AS display_name,
  json_extract(json, '$.account.avatar') AS avatar_url,
  json_extract(json, '$.account.header') AS header_url,
  COALESCE(json_extract(json, '$.account.locked'), 0) AS locked,
  COALESCE(json_extract(json, '$.account.bot'), 0) AS bot,
  datetime('now') AS updated_at
FROM posts
WHERE json_extract(json, '$.account.url') IS NOT NULL
  AND json_extract(json, '$.account.url') != '';
```

### Step 3: profile_aliases の生成

```sql
-- posts_backends を通じて、各バックエンドでの account_id を記録
INSERT OR IGNORE INTO profile_aliases (server_id, remote_account_id, profile_id, fetched_at)
SELECT DISTINCT
  pb.server_id,
  p.account_id,
  pr.profile_id,
  datetime('now')
FROM posts p
INNER JOIN posts_backends pb ON p.post_id = pb.post_id
INNER JOIN profiles pr ON pr.acct = p.account_acct
WHERE pb.server_id IS NOT NULL
  AND p.account_id != '';
```

### Step 4: posts に author_profile_id カラム追加

```sql
ALTER TABLE posts ADD COLUMN author_profile_id INTEGER
  REFERENCES profiles(profile_id);

UPDATE posts SET author_profile_id = (
  SELECT pr.profile_id FROM profiles pr WHERE pr.acct = posts.account_acct
);

CREATE INDEX idx_posts_author ON posts(author_profile_id, created_at_ms DESC);
```

### Step 5: notifications に actor_profile_id カラム追加

```sql
ALTER TABLE notifications ADD COLUMN actor_profile_id INTEGER
  REFERENCES profiles(profile_id);

UPDATE notifications SET actor_profile_id = (
  SELECT pr.profile_id FROM profiles pr WHERE pr.acct = notifications.account_acct
);
```

### Step 6: home_server_id の補完

```sql
-- プロフィールの所属サーバーを推定
-- domain が NULL（ローカルユーザー）の場合は、最初に出現した backendUrl のサーバー
UPDATE profiles SET home_server_id = (
  SELECT s.server_id FROM servers s
  WHERE s.host = profiles.domain
) WHERE domain IS NOT NULL AND home_server_id IS NULL;
```

## アプリケーション層の変更

### 変更が必要なファイル

| ファイル                     | 変更内容                                            |
| ---------------------------- | --------------------------------------------------- |
| `schema.ts`                  | `SCHEMA_VERSION = 9`、`migrateV8toV9()` 追加        |
| `shared.ts`                  | `ensureProfile(db, account)` ヘルパー追加           |
| `workerStatusStore.ts`       | upsert 時に profiles への UPSERT を追加             |
| `workerNotificationStore.ts` | 同上                                                |
| `statusStore.ts`             | クエリに profiles JOIN を追加（将来の表示名取得用） |

### ensureProfile ヘルパー

```typescript
// shared.ts に追加
export function ensureProfile(db: DbExec, account: Entity.Account): number {
  const actorUri = account.url;

  // UPSERT（既存なら更新、なければ挿入）
  db.exec(
    `INSERT INTO profiles (
      actor_uri, acct, username, domain, display_name,
      avatar_url, header_url, locked, bot, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(actor_uri) DO UPDATE SET
      display_name = excluded.display_name,
      avatar_url   = excluded.avatar_url,
      header_url   = excluded.header_url,
      locked       = excluded.locked,
      bot          = excluded.bot,
      updated_at   = excluded.updated_at;`,
    {
      bind: [
        actorUri,
        account.acct,
        account.username,
        account.acct.includes("@") ? account.acct.split("@")[1] : null,
        account.display_name ?? null,
        account.avatar ?? null,
        account.header ?? null,
        account.locked ? 1 : 0,
        account.bot ? 1 : 0,
      ],
    },
  );

  const rows = db.exec("SELECT profile_id FROM profiles WHERE actor_uri = ?;", {
    bind: [actorUri],
    returnValue: "resultRows",
  }) as number[][];

  return rows[0][0];
}
```

## テスト項目

- [ ] profiles テーブルに既存アカウント情報が正しくバックフィルされる
- [ ] 同一 acct のプロフィールが重複しない
- [ ] profile_aliases が正しくサーバー × account_id で記録される
- [ ] `author_profile_id` が正しく紐づく
- [ ] 新規投稿の upsert 時にプロフィールが自動作成/更新される
- [ ] 既存のクエリ API が壊れない（`account_acct` はまだ残存）
- [ ] `yarn build` / `yarn check` が通る

## 備考

- `account_acct`, `account_id` カラムは Phase 7 で json 廃止時にまとめて削除
- local_accounts への実データ投入はアプリ側の認証フローと連携が必要
  （本フェーズではテーブル定義のみ。投入はアプリ側で認証成功時に行う）
- profile_fields のバックフィルは JSON に fields データがある場合のみ実行
