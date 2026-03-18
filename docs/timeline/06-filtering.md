# 06. フィルタリングシステム

## 概要

タイムラインのフィルタリングは **すべてデータベースレイヤー（SQL）** で実行される。メモリ上でのフィルタリングは行わない。これにより、大量のデータに対しても効率的にフィルタを適用でき、インデックスの恩恵を受けられる。

## フィルタの分類

### バックエンドフィルタ

どのサーバのデータを対象とするか。

| モード | SQL |
|--------|-----|
| `all` | 条件なし（全バックエンド） |
| `single` | `pb.backendUrl = ?` |
| `composite` | `pb.backendUrl IN (?, ?, ...)` |

### タイムラインタイプフィルタ

どのタイムライン種別のデータを対象とするか。

```sql
-- 単一タイプ
ck.code = 'home'

-- 複数タイプ（timelineTypes 設定時）
ck.code IN ('home', 'local')
```

`timelines` + `channel_kinds` テーブルの JOIN で実現。

### メディアフィルタ

```sql
-- onlyMedia: true
p.has_media = 1

-- minMediaCount: 3
p.media_count >= 3
```

`has_media` と `media_count` は `posts` テーブルに非正規化されたカラム。`post_media` との JOIN なしでフィルタ可能。

### 可視性フィルタ

```sql
-- visibilityFilter: ['public', 'unlisted']
p.visibility_id IN (
  SELECT visibility_id FROM visibility_types WHERE code IN ('public', 'unlisted')
)
```

`visibility_types` マスタテーブルのサブクエリで ID を解決。

### 言語フィルタ

```sql
-- languageFilter: ['ja', 'en']
p.language IN ('ja', 'en')
```

Mastodon の `language` フィールドは ISO 639-1 コード。投稿者が言語を指定しなかった場合は `NULL` となり、このフィルタからは除外される。

### 除外フィルタ

```sql
-- excludeReblogs
p.is_reblog = 0

-- excludeReplies
p.in_reply_to_id IS NULL

-- excludeSpoiler
p.has_spoiler = 0

-- excludeSensitive
p.is_sensitive = 0
```

いずれも `posts` テーブルのカラムを直接参照。

### アカウントフィルタ

```sql
-- include モード
pr.acct IN ('user1@mastodon.social', 'user2@example.com')

-- exclude モード
pr.acct NOT IN ('spammer@bad.instance')
```

`profiles` テーブルとの JOIN が必要。

### ミュートフィルタ

```sql
-- applyMuteFilter: true（デフォルト）
NOT EXISTS (
  SELECT 1 FROM muted_accounts ma
  WHERE ma.account_acct = pr.acct
  AND ma.backendUrl = pb.backendUrl
)
```

`muted_accounts` テーブルはバックエンドごとにミュート設定を保持。異なるサーバで異なるミュートリストを持てる。

### インスタンスブロックフィルタ

```sql
-- applyInstanceBlock: true（デフォルト）
NOT EXISTS (
  SELECT 1 FROM blocked_instances bi
  WHERE pr.domain = bi.instance_domain
)
```

### フォローフィルタ

```sql
-- followsOnly: true
EXISTS (
  SELECT 1 FROM follows f
  WHERE f.target_profile_id = p.author_profile_id
)
```

`follows` テーブルにフォロー関係を事前にロードしておく必要がある。`StatusStoreProvider` が初期化時に `getAccountFollowing()` で取得・同期する。

### 通知タイプフィルタ

通知タイムライン用。

```sql
-- notificationFilter: ['mention', 'favourite']
nt.code IN ('mention', 'favourite')
```

`notification_types` マスタテーブルと JOIN。

## タグフィルタリング

`useFilteredTagTimeline` が処理する。タグの組み合わせ方法に 2 モードある。

### OR モード（いずれかのタグ）

```sql
SELECT DISTINCT p.post_id
FROM posts p
JOIN posts_belonging_tags pbt ON pbt.post_id = p.post_id
WHERE pbt.tag IN ('tag1', 'tag2', 'tag3')
-- + 他のフィルタ条件
ORDER BY p.created_at_ms DESC
LIMIT 50
```

`DISTINCT` で同じ投稿が複数タグにマッチした場合の重複を排除。

### AND モード（すべてのタグ）

```sql
SELECT p.post_id
FROM posts p
JOIN posts_belonging_tags pbt ON pbt.post_id = p.post_id
WHERE pbt.tag IN ('tag1', 'tag2')
-- + 他のフィルタ条件
GROUP BY p.post_id
HAVING COUNT(DISTINCT pbt.tag) = 2  -- タグ数と一致
ORDER BY p.created_at_ms DESC
LIMIT 50
```

`HAVING COUNT(DISTINCT tag)` でタグ数の条件を付けて AND を実現。

## フィルタの組み合わせ

`buildFilterConditions()` が生成するすべての条件は **AND** で結合される。

```sql
WHERE ck.code = 'public'                           -- タイムラインタイプ
  AND pb.backendUrl IN (?, ?)                      -- バックエンド
  AND p.has_media = 1                              -- メディアあり
  AND p.visibility_id IN (...)                     -- 可視性
  AND p.language IN ('ja')                         -- 言語
  AND p.is_reblog = 0                              -- ブースト除外
  AND p.in_reply_to_id IS NULL                     -- リプライ除外
  AND NOT EXISTS (SELECT 1 FROM muted_accounts...) -- ミュート
  AND NOT EXISTS (SELECT 1 FROM blocked_instances...)-- ブロック
```

## UI ↔ Advanced Query の相互変換

`TimelineEditPanel` では UI モードと Advanced Query モードを切り替えられる。

### UI → Advanced Query

UI のフィルタ設定を `queryBuilder.ts` の `buildQueryFromConfig()` が SQL WHERE 句に変換する。

```
UI: type=public, onlyMedia=true, languageFilter=['ja']
    ↓
SQL: ck.code = 'public' AND p.has_media = 1 AND p.language IN ('ja')
```

### Advanced Query → UI

Advanced Query から UI モードに戻す場合、SQL のパースは行わず、**設定は保持されない**（カスタムクエリは破棄される）。`TimelineEditPanel` がパース警告を表示する。

## パフォーマンス考慮

### インデックスの活用

頻出フィルタに対してインデックスを設定：

- `idx_posts_media_filter` → `(has_media, media_count)`
- `idx_posts_visibility_filter` → `(visibility_id)`
- `idx_posts_language_filter` → `(language)`
- `idx_posts_reblog_filter` → `(is_reblog)`
- `idx_posts_backend_created` → `(backendUrl, post_id)`

### 非正規化カラムの効果

`has_media`, `is_reblog`, `is_sensitive`, `has_spoiler` は本来 JOIN して計算すべき値だが、`posts` テーブルに直接持たせることで：

- Phase 1 の WHERE で JOIN なしにフィルタ可能
- インデックスが直接効く
- クエリプランが単純化される

### NOT EXISTS vs LEFT JOIN + IS NULL

ミュートとインスタンスブロックには `NOT EXISTS` サブクエリを使用。`LEFT JOIN ... WHERE ... IS NULL` よりも SQLite のクエリオプティマイザに適している場合が多い。
