# 03. データストレージ (SQLite)

## 概要

miyulab-fe は投稿データや通知データをブラウザ内の SQLite（OPFS: Origin Private File System 上）に蓄積します。正規化カラムを活用した SQL レベルでのフィルタリングにより、LIMIT の精度が高く JavaScript 側のフィルタが不要な設計です。

## スキーマバージョン

スキーマは 3 世代のバージョンを経て進化しています。

| バージョン | 概要 |
|---|---|
| V1 | 基本的な statuses / notifications テーブル |
| V2 | 正規化カラム追加、muted_accounts / blocked_instances / statuses_mentions テーブル追加 |
| V3 | uri ベースの重複排除、statuses_backends テーブル追加、reblog_of_uri カラム追加 |

現在のスキーマバージョンは `SCHEMA_VERSION = 3` であり、`ensureSchema()` 関数が起動時にバージョンチェックを行い、必要に応じてマイグレーションを実行します。

## テーブル構成

### statuses（投稿本体）

投稿データの本体を保持するメインテーブルです。JSON 全体と、フィルタリングに使用する正規化カラムを併せ持ちます。

```sql
CREATE TABLE IF NOT EXISTS statuses (
  compositeKey      TEXT PRIMARY KEY,
  backendUrl        TEXT NOT NULL,
  created_at_ms     INTEGER NOT NULL,
  storedAt          INTEGER NOT NULL,
  uri               TEXT NOT NULL DEFAULT '',
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
```

#### カラム解説

| カラム | 型 | 説明 |
|---|---|---|
| `compositeKey` | TEXT (PK) | 一意識別子（`backendUrl:statusId` 形式、v3 では uri ベースで統合） |
| `backendUrl` | TEXT | 投稿を最初に取得したバックエンドの URL |
| `created_at_ms` | INTEGER | 投稿日時（Unix ミリ秒）。ソート・ページネーションに使用 |
| `storedAt` | INTEGER | SQLite への格納日時（Unix ミリ秒）。クリーンアップに使用 |
| `uri` | TEXT | 投稿の URI（ActivityPub の一意識別子）。v3 での重複排除キー |
| `account_acct` | TEXT | 投稿者のアカウント識別子（例: `user@mastodon.social`） |
| `account_id` | TEXT | 投稿者のアカウント ID |
| `visibility` | TEXT | 公開範囲（`public` / `unlisted` / `private` / `direct`） |
| `language` | TEXT | 投稿の言語コード（例: `ja`, `en`）。`NULL` の場合あり |
| `has_media` | INTEGER | メディア添付の有無（0 / 1） |
| `media_count` | INTEGER | メディア添付の枚数 |
| `is_reblog` | INTEGER | ブースト投稿かどうか（0 / 1） |
| `reblog_of_id` | TEXT | ブースト元投稿の ID（ブーストでない場合は `NULL`） |
| `reblog_of_uri` | TEXT | ブースト元投稿の URI（v3 追加） |
| `is_sensitive` | INTEGER | センシティブフラグ（0 / 1） |
| `has_spoiler` | INTEGER | CW（Content Warning）の有無（0 / 1） |
| `in_reply_to_id` | TEXT | リプライ先投稿の ID（トップレベル投稿の場合は `NULL`） |
| `favourites_count` | INTEGER | お気に入り数 |
| `reblogs_count` | INTEGER | ブースト数 |
| `replies_count` | INTEGER | リプライ数 |
| `json` | TEXT | 投稿データの完全な JSON 文字列 |

#### インデックス

```sql
-- 基本インデックス
CREATE INDEX idx_statuses_backendUrl ON statuses(backendUrl);
CREATE INDEX idx_statuses_backend_created ON statuses(backendUrl, created_at_ms DESC);
CREATE INDEX idx_statuses_storedAt ON statuses(storedAt);
CREATE INDEX idx_statuses_account_acct ON statuses(account_acct);
CREATE INDEX idx_statuses_reblog_of_id ON statuses(reblog_of_id);

-- v2 フィルタ用インデックス
CREATE INDEX idx_statuses_media_filter ON statuses(backendUrl, has_media, created_at_ms DESC);
CREATE INDEX idx_statuses_visibility_filter ON statuses(backendUrl, visibility, created_at_ms DESC);
CREATE INDEX idx_statuses_language_filter ON statuses(backendUrl, language, created_at_ms DESC);
CREATE INDEX idx_statuses_reblog_filter ON statuses(backendUrl, is_reblog, created_at_ms DESC);

-- v3 インデックス
CREATE UNIQUE INDEX idx_statuses_uri ON statuses(uri) WHERE uri != '';
CREATE INDEX idx_statuses_reblog_of_uri ON statuses(reblog_of_uri);
```

### statuses_timeline_types（投稿 × タイムライン種別）

投稿がどのタイムライン種別に属するかを管理する多対多テーブルです。

```sql
CREATE TABLE IF NOT EXISTS statuses_timeline_types (
  compositeKey  TEXT NOT NULL,
  timelineType  TEXT NOT NULL,
  PRIMARY KEY (compositeKey, timelineType),
  FOREIGN KEY (compositeKey) REFERENCES statuses(compositeKey) ON DELETE CASCADE
);

CREATE INDEX idx_stt_type ON statuses_timeline_types(timelineType);
```

- `timelineType` の値: `'home'` / `'local'` / `'public'` / `'tag'`
- 1 つの投稿が複数のタイムライン種別に属し得る（例: Home TL と Local TL の両方に表示される投稿）
- `useFilteredTimeline` が `INNER JOIN` でこのテーブルを結合し、指定された `timelineType` の投稿のみを取得

### statuses_belonging_tags（投稿 × タグ）

投稿に含まれるハッシュタグとの関連を管理する多対多テーブルです。

```sql
CREATE TABLE IF NOT EXISTS statuses_belonging_tags (
  compositeKey  TEXT NOT NULL,
  tag           TEXT NOT NULL,
  PRIMARY KEY (compositeKey, tag),
  FOREIGN KEY (compositeKey) REFERENCES statuses(compositeKey) ON DELETE CASCADE
);

CREATE INDEX idx_sbt_tag ON statuses_belonging_tags(tag);
```

- タグ名は小文字に正規化して格納
- `useFilteredTagTimeline` が `INNER JOIN` でこのテーブルを結合し、指定されたタグの投稿を取得
- OR 条件: `IN (tag1, tag2, ...) + GROUP BY` で重複排除
- AND 条件: `IN (tag1, tag2, ...) + HAVING COUNT(DISTINCT tag) = N`

### statuses_backends（投稿 × バックエンド, v3）

同一投稿（同一 URI）が複数のバックエンドから取得された場合の関連を管理する多対多テーブルです。

```sql
CREATE TABLE IF NOT EXISTS statuses_backends (
  compositeKey  TEXT NOT NULL,
  backendUrl    TEXT NOT NULL,
  local_id      TEXT NOT NULL,
  PRIMARY KEY (backendUrl, local_id),
  FOREIGN KEY (compositeKey) REFERENCES statuses(compositeKey) ON DELETE CASCADE
);

CREATE INDEX idx_sb_compositeKey ON statuses_backends(compositeKey);
CREATE INDEX idx_sb_backendUrl ON statuses_backends(backendUrl);
```

- v3 で追加。v2 以前は `statuses.backendUrl` が 1:1 だったが、v3 では 1:N に拡張
- `local_id` はそのバックエンドにおける投稿のローカル ID
- `useFilteredTimeline` / `useFilteredTagTimeline` のクエリで `INNER JOIN statuses_backends sb` として結合し、`sb.backendUrl IN (?)` で対象バックエンドをフィルタ
- `MIN(sb.backendUrl) AS backendUrl` で GROUP BY 後に 1 つの backendUrl を選択

### statuses_mentions（投稿 × メンション, v2）

投稿に含まれるメンションとの関連を管理する多対多テーブルです。

```sql
CREATE TABLE IF NOT EXISTS statuses_mentions (
  compositeKey  TEXT NOT NULL,
  acct          TEXT NOT NULL,
  PRIMARY KEY (compositeKey, acct),
  FOREIGN KEY (compositeKey) REFERENCES statuses(compositeKey) ON DELETE CASCADE
);

CREATE INDEX idx_sm_acct ON statuses_mentions(acct);
```

- カスタムクエリで `sm.acct` を参照して「特定ユーザーへのメンションを含む投稿」を検索する用途
- `useCustomQueryTimeline` で `LEFT JOIN` される

### muted_accounts（ミュートアカウント, v2）

ミュートしたアカウントを管理するテーブルです。

```sql
CREATE TABLE IF NOT EXISTS muted_accounts (
  backendUrl    TEXT NOT NULL,
  account_acct  TEXT NOT NULL,
  muted_at      INTEGER NOT NULL,
  PRIMARY KEY (backendUrl, account_acct)
);
```

- バックエンドごとにミュート設定が独立
- `buildMuteCondition()` がサブクエリとして WHERE 句に追加
- `accountFilter.mode === 'include'` の場合はミュートフィルタが適用されない

### blocked_instances（ブロックインスタンス, v2）

ブロックしたインスタンスドメインを管理するテーブルです。

```sql
CREATE TABLE IF NOT EXISTS blocked_instances (
  instance_domain TEXT PRIMARY KEY,
  blocked_at      INTEGER NOT NULL
);
```

- `buildInstanceBlockCondition()` がサブクエリとして WHERE 句に追加
- 投稿者のアカウント acct からドメインを抽出して照合

### notifications（通知）

通知データを保持するテーブルです。

```sql
CREATE TABLE IF NOT EXISTS notifications (
  compositeKey      TEXT PRIMARY KEY,
  backendUrl        TEXT NOT NULL,
  created_at_ms     INTEGER NOT NULL,
  storedAt          INTEGER NOT NULL,
  notification_type TEXT NOT NULL DEFAULT '',
  status_id         TEXT,
  account_acct      TEXT NOT NULL DEFAULT '',
  json              TEXT NOT NULL
);

CREATE INDEX idx_notifications_backendUrl ON notifications(backendUrl);
CREATE INDEX idx_notifications_backend_created ON notifications(backendUrl, created_at_ms DESC);
CREATE INDEX idx_notifications_storedAt ON notifications(storedAt);
CREATE INDEX idx_notifications_type ON notifications(notification_type);
CREATE INDEX idx_notifications_status_id ON notifications(backendUrl, status_id);
CREATE INDEX idx_notifications_account_acct ON notifications(account_acct);
```

## compositeKey の生成

### 基本ルール

`compositeKey` は投稿の一意識別子であり、`createCompositeKey()` 関数で生成されます。

```typescript
function createCompositeKey(backendUrl: string, statusId: string): string {
  return `${backendUrl}:${statusId}`
}
```

例: `"https://mastodon.social:123456"`

### v3 における URI ベースの解決

v3 スキーマでは、同一投稿が複数のバックエンドから取得される場合、`uri`（ActivityPub の一意識別子）をキーとして重複排除を行います。

```typescript
function resolveCompositeKey(db, uri: string): string | null {
  // uri から既存の compositeKey を検索
  const rows = db.exec(
    'SELECT compositeKey FROM statuses WHERE uri = ? LIMIT 1;',
    { bind: [uri], returnValue: 'resultRows' }
  )
  return rows.length > 0 ? rows[0][0] : null
}
```

#### 解決フロー

```
新しい投稿を受信
  │
  ├── uri が存在 → resolveCompositeKey() で既存キーを検索
  │   ├── 既存キーあり → そのキーで UPDATE（statuses_backends に新バックエンドを追加）
  │   └── 既存キーなし → createCompositeKey() で新キーを生成して INSERT
  │
  └── uri が空 → createCompositeKey() で新キーを生成して INSERT
```

## 正規化カラムの設計意図

### なぜ JSON と正規化カラムの両方を持つのか

1. **JSON カラム**: 投稿データの完全な保存。UI レンダリングには完全なオブジェクトが必要
2. **正規化カラム**: SQL の WHERE 句で直接フィルタリングするため

### 正規化カラムの抽出

`extractStatusColumns()` 関数が Mastodon のステータスオブジェクトから正規化カラム値を抽出します。

```typescript
function extractStatusColumns(status: Entity.Status) {
  return {
    account_acct: status.account.acct,
    account_id: status.account.id,
    favourites_count: status.favourites_count ?? 0,
    has_media: (status.media_attachments?.length ?? 0) > 0 ? 1 : 0,
    has_spoiler: status.spoiler_text ? 1 : 0,
    in_reply_to_id: status.in_reply_to_id ?? null,
    is_reblog: status.reblog ? 1 : 0,
    is_sensitive: status.sensitive ? 1 : 0,
    language: status.language ?? null,
    media_count: status.media_attachments?.length ?? 0,
    reblog_of_id: status.reblog?.id ?? null,
    reblog_of_uri: status.reblog?.uri ?? null,
    reblogs_count: status.reblogs_count ?? 0,
    replies_count: status.replies_count ?? 0,
    uri: status.uri ?? '',
    visibility: status.visibility ?? 'public',
  }
}
```

### SQL フィルタリングのメリット

```sql
-- 例: メディア付きの日本語投稿を40件取得
SELECT s.compositeKey, MIN(sb.backendUrl) AS backendUrl,
       s.created_at_ms, s.storedAt, s.json
FROM statuses s
INNER JOIN statuses_timeline_types stt ON s.compositeKey = stt.compositeKey
INNER JOIN statuses_backends sb ON s.compositeKey = sb.compositeKey
WHERE stt.timelineType = 'public'
  AND sb.backendUrl IN ('https://mastodon.social')
  AND s.has_media = 1
  AND (s.language IN ('ja') OR s.language IS NULL)
GROUP BY s.compositeKey
ORDER BY s.created_at_ms DESC
LIMIT 40;
```

JavaScript 側のフィルタでは「100 件取得 → JS でフィルタ → 5 件しか残らない」という事態が起こり得ますが、SQL フィルタなら「条件に合致する 40 件」を正確に取得できます。

## データの書き込み

### upsertStatus（単一投稿）

ストリーミングイベント（`update`）で受信した投稿を 1 件ずつ書き込みます。

```
upsertStatus(status, backendUrl, timelineType, tag?)
  │
  ├── uri から既存 compositeKey を解決
  │   ├── 既存あり → UPDATE (正規化カラム + json + storedAt)
  │   └── 既存なし → INSERT
  │
  ├── statuses_timeline_types に timelineType を UPSERT
  ├── statuses_backends に backendUrl + local_id を UPSERT
  ├── statuses_belonging_tags に tag を UPSERT（tag 指定時）
  ├── statuses_mentions にメンションを UPSERT
  │
  └── notify('statuses') で変更を通知
```

### bulkUpsertStatuses（一括投稿）

REST API で取得した投稿を一括で書き込みます。基本的なフローは `upsertStatus` と同じですが、複数投稿をループ処理します。

```
bulkUpsertStatuses(statuses[], backendUrl, timelineType, tag?)
  │
  ├── URI キャッシュを作成（同一バッチ内の重複排除）
  ├── 各投稿について upsertStatus と同様の処理
  │
  └── notify('statuses') で変更を通知（バッチ全体で 1 回）
```

### updateStatusAction（投稿のアクション更新）

お気に入り・ブースト・ブックマーク等のアクション結果を反映します。

```
updateStatusAction(backendUrl, statusId, updater)
  │
  ├── compositeKey を算出
  ├── 既存の JSON を取得
  ├── updater 関数で JSON を更新
  ├── 正規化カラムを再抽出
  ├── UPDATE 実行
  │
  ├── reblog 元投稿がある場合 → reblog_of_uri から元投稿も更新
  ├── 同じ URI を持つ他のレコードも更新（マルチバックエンド対応）
  │
  └── notify('statuses') で変更を通知
```

### handleDeleteEvent（投稿の削除）

ストリーミングイベント（`delete`）で受信した削除イベントを処理します。

```
handleDeleteEvent(backendUrl, statusId, timelineType, tag?)
  │
  ├── compositeKey を算出
  ├── statuses_backends から該当バックエンドのエントリを削除
  │
  ├── 残りのバックエンドが存在するか確認
  │   ├── 存在する → statuses レコードは維持（他バックエンドでまだ有効）
  │   └── 存在しない → statuses レコードごと削除（CASCADE で関連テーブルも削除）
  │
  └── notify('statuses') で変更を通知
```

## リアクティブ更新 (subscribe / notify)

### 仕組み

SQLite への書き込み操作の末尾で `notify('statuses')` が呼ばれると、`subscribe('statuses', callback)` で登録された全コールバックが実行されます。

```typescript
// connection.ts（概念コード）
const listeners = new Map<string, Set<() => void>>()

export function subscribe(table: string, callback: () => void): () => void {
  if (!listeners.has(table)) listeners.set(table, new Set())
  listeners.get(table)!.add(callback)
  return () => listeners.get(table)?.delete(callback) // cleanup 関数
}

export function notify(table: string): void {
  listeners.get(table)?.forEach((cb) => cb())
}
```

### Hook での利用パターン

```typescript
useEffect(() => {
  fetchData()                             // 初回データ取得
  return subscribe('statuses', fetchData) // 変更通知で再取得
}, [fetchData])
```

`fetchData` は `useCallback` でメモ化されており、依存する config / targetBackendUrls / filterConditions が変わらない限り参照が安定します。これにより不要な再購読が防がれます。

## クリーンアップ

### 古いデータの削除

`storedAt` カラムを使用して、一定期間以上前に格納されたデータを定期的にクリーンアップします。

```sql
-- 例: 7日以上前のデータを削除
DELETE FROM statuses WHERE storedAt < ?;
```

`ON DELETE CASCADE` により、`statuses` のレコードが削除されると関連テーブル（`statuses_timeline_types`, `statuses_belonging_tags`, `statuses_backends`, `statuses_mentions`）のレコードも自動的に削除されます。

### removeFromTimeline（タイムラインからの除去）

特定のタイムライン種別やタグからの関連のみを削除し、投稿自体は保持する場合に使用します。

```
removeFromTimeline(backendUrl, statusId, timelineType, tag?)
  │
  ├── statuses_timeline_types から該当レコードを削除
  ├── tag 指定時 → statuses_belonging_tags から該当レコードを削除
  │
  ├── 残りの timeline_types / belonging_tags が存在するか確認
  │   ├── 存在する → statuses レコードは維持
  │   └── 存在しない → statuses レコードも削除
  │
  └── notify('statuses') で変更を通知
```

## URI ベースの重複排除 (v3)

### 背景

マルチバックエンド環境では、同一の投稿（同一の ActivityPub URI）が異なるバックエンドから取得されることがあります。v2 以前はこれらが別々の `compositeKey` で格納され、タイムライン上に重複表示されていました。

### v3 の解決策

1. **`statuses_backends` テーブル**: 投稿 × バックエンドの多対多関連を管理
2. **`uri` カラムの UNIQUE インデックス**: 同一 URI の重複投稿を防止
3. **`resolveCompositeKey()`**: 新しい投稿の受信時に既存の URI から compositeKey を解決

### deduplicateByUri

v2 → v3 マイグレーション時に、既存データの重複排除を行うバックフィル関数です。

```
deduplicateByUri()
  │
  ├── 同一 URI で複数の compositeKey を持つレコードを検出
  │
  ├── 各重複グループについて:
  │   ├── 最も古い compositeKey を「勝者」として選択
  │   ├── 「敗者」の関連データ（timeline_types, tags, backends）を勝者に移行
  │   └── 「敗者」レコードを削除
  │
  └── 重複のない状態に統合
```

## クエリ補完機能

`statusStore.ts` には `QUERY_COMPLETIONS` 定数が定義されており、カスタムクエリエディタでの入力補完に使用されます。

### 提供される補完情報

| カテゴリ | 説明 |
|---|---|
| `aliases` | テーブルエイリアス（`s`, `sb`, `sbt`, `sm`, `stt`） |
| `columns` | 各テーブルのカラム名 |
| `examples` | SQL クエリの使用例 |
| `jsonPaths` | JSON パス（`json_extract` で使用） |
| `keywords` | SQL キーワード |

### 動的補完

以下の関数で実行時にデータベースの内容から補完候補を動的に取得できます。

| 関数 | 説明 |
|---|---|
| `getDistinctTags()` | 登録されているタグの一覧 |
| `getDistinctTimelineTypes()` | 登録されているタイムライン種別の一覧 |
| `getJsonKeysFromSample(table, limit)` | JSON カラムのサンプルからキーパスを抽出 |
| `getDistinctJsonValues(path, limit)` | 特定の JSON パスの値の一覧 |
| `getDistinctColumnValues(table, column, limit)` | 特定カラムの値の一覧 |

## スキーママイグレーション

### V1 → V2

`migrateV1toV2()` で以下の変更を適用します。

- `statuses` テーブルに正規化カラムを追加（`account_acct`, `visibility`, `language`, `has_media`, `media_count`, `is_reblog`, `is_sensitive`, `has_spoiler`, `in_reply_to_id` 等）
- `notifications` テーブルに正規化カラムを追加（`notification_type`, `status_id`, `account_acct`）
- `muted_accounts` テーブルを新規作成
- `blocked_instances` テーブルを新規作成
- `statuses_mentions` テーブルを新規作成
- 既存データのバックフィル（`backfillStatusesV2`, `backfillNotificationsV2`, `backfillMentionsV2`）

### V2 → V3

`migrateV2toV3()` で以下の変更を適用します。

- `statuses` テーブルに `uri`, `reblog_of_uri` カラムを追加
- `statuses_backends` テーブルを新規作成
- `uri` の UNIQUE インデックスを作成
- 既存データのバックフィル（`backfillStatusesV3`）
- URI ベースの重複排除（`deduplicateByUri`）

### バックフィル処理

マイグレーション時に既存の JSON データから新規カラムの値を再抽出して更新します。

```typescript
// backfillStatusesV2: JSON から正規化カラムを再抽出
function backfillStatusesV2(handle: DbHandle): void {
  const rows = db.exec('SELECT compositeKey, json FROM statuses;', ...)
  for (const row of rows) {
    const status = JSON.parse(row[1])
    const cols = extractStatusColumns(status)
    db.exec('UPDATE statuses SET account_acct = ?, ... WHERE compositeKey = ?', ...)
  }
}
```

バックフィル処理は既存データの量に応じて時間がかかる可能性がありますが、ブラウザの SQLite（OPFS）はシングルスレッドのため、UI のブロッキングを最小限に抑えるよう設計されています。
