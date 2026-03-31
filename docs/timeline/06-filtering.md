# 06. フィルタリングシステム

## 概要

タイムラインのフィルタリングは **すべてデータベースレイヤー（SQL）** で実行される。メモリ上でのフィルタリングは行わない。これにより、大量のデータに対しても効率的にフィルタを適用できる。

## フィルタの分類

### バックエンドフィルタ

どのサーバのデータを対象とするか。`local_accounts` テーブル経由で解決。

| モード | SQL |
|--------|-----|
| `all` | 条件なし（全バックエンド） |
| `single` | `la.backend_url = ?` |
| `composite` | `la.backend_url IN (?, ?, ...)` |

### タイムラインタイプフィルタ

どのタイムライン種別のデータを対象とするか。`timeline_entries` テーブルで管理。

```
-- 単一タイプ
HAVING MAX(te.timeline_key = 'home') = 1

-- 複数タイプ（timelineTypes 設定時）
HAVING MAX(te.timeline_key IN ('home', 'local')) = 1
```

### メディアフィルタ

```
-- onlyMedia: true
EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)

-- minMediaCount: 3
(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= 3
```

v2 スキーマでは `post_media` テーブルのサブクエリでフィルタ。posts テーブルに `has_media` カラムは持たない。

### 可視性フィルタ

```
-- visibilityFilter: ['public', 'unlisted']
(SELECT name FROM visibility_types WHERE id = p.visibility_id) IN ('public', 'unlisted')
```

`visibility_types` ルックアップテーブルのサブクエリで名前を解決。

### 言語フィルタ

```
-- languageFilter: ['ja', 'en']
(p.language IN ('ja', 'en') OR p.language IS NULL)
```

Mastodon の `language` フィールドは ISO 639-1 コード。投稿者が言語を指定しなかった場合は `NULL` となるが、**NULL は常に表示される**（言語未指定の投稿がフィルタで消えるのを防ぐ）。

### 除外フィルタ

```
-- excludeReblogs
p.is_reblog = 0

-- excludeReplies
p.in_reply_to_uri IS NULL

-- excludeSpoiler（CW 付き除外）
p.spoiler_text = ''

-- excludeSensitive
p.is_sensitive = 0
```

`excludeSpoiler` は `spoiler_text` が空文字列かで判定（v2 スキーマでは `has_spoiler` カラムを廃止）。

### アカウントフィルタ

```
-- include モード
(SELECT acct FROM profiles WHERE id = p.author_profile_id) IN ('user1@mastodon.social', 'user2@example.com')

-- exclude モード
(SELECT acct FROM profiles WHERE id = p.author_profile_id) NOT IN ('spammer@bad.instance')
```

`profiles` テーブルのサブクエリで `acct` を解決。`profileJoined: true` オプション時は `pr.acct` を直接使用。

### ミュートフィルタ

`buildMuteCondition()` が生成するサブクエリ。`muted_accounts` テーブル（v2.0.1 追加）を参照。

**重要**: `accountFilter.mode === 'include'` の場合、ミュートフィルタは **適用されない**。ユーザーが明示的に指定したアカウントがミュートで表示されなくなるのは不適切なため。

### インスタンスブロックフィルタ

`buildInstanceBlockCondition()` が生成するサブクエリ。`blocked_instances` テーブル（v2.0.1 追加）を参照。

### フォローフィルタ

```
-- followsOnly: true
⚠️ 未実装（v2 スキーマに follows テーブルが存在しない）
```

`buildFilterConditions()` では `followsOnly: true` の場合に警告ログを出力し、条件は生成しない。

### 通知タイプフィルタ

通知タイムライン用。

```
-- notificationFilter: ['mention', 'favourite']
nt.name IN ('mention', 'favourite')
```

`notification_types` ルックアップテーブルと JOIN。

## タグフィルタリング

`useFilteredTagTimeline` が処理する。タグの組み合わせ方法に 2 モードある。

### OR モード（いずれかのタグ）

```
SELECT p.id, MIN(la.backend_url) AS backendUrl
FROM posts p
LEFT JOIN post_backend_ids pbi ON p.id = pbi.post_id
LEFT JOIN local_accounts la ON pbi.local_account_id = la.id
LEFT JOIN profiles pr ON p.author_profile_id = pr.id
INNER JOIN post_hashtags pht ON p.id = pht.post_id
INNER JOIN hashtags ht ON pht.hashtag_id = ht.id
WHERE ht.name IN ('tag1', 'tag2', 'tag3')
  AND la.backend_url IN (?, ?)
  -- + 他のフィルタ条件
GROUP BY p.id
ORDER BY p.created_at_ms DESC
LIMIT 50
```

`GROUP BY` で同じ投稿が複数タグにマッチした場合の重複を排除。

### AND モード（すべてのタグ）

```
SELECT p.id, MIN(la.backend_url) AS backendUrl
FROM posts p
LEFT JOIN post_backend_ids pbi ON p.id = pbi.post_id
LEFT JOIN local_accounts la ON pbi.local_account_id = la.id
LEFT JOIN profiles pr ON p.author_profile_id = pr.id
INNER JOIN post_hashtags pht ON p.id = pht.post_id
INNER JOIN hashtags ht ON pht.hashtag_id = ht.id
WHERE ht.name IN ('tag1', 'tag2')
  AND la.backend_url IN (?, ?)
  -- + 他のフィルタ条件
GROUP BY p.id
HAVING COUNT(DISTINCT ht.name) = 2  -- タグ数と一致
ORDER BY p.created_at_ms DESC
LIMIT 50
```

`HAVING COUNT(DISTINCT ht.name)` でタグ数の条件を付けて AND を実現。

## フィルタの組み合わせ

`buildFilterConditions()` が生成するすべての条件は **AND** で結合される。

```
WHERE la.backend_url IN (?, ?)                                -- バックエンド
  AND EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)   -- メディアあり
  AND (SELECT name FROM visibility_types ...) IN (...)         -- 可視性
  AND (p.language IN ('ja') OR p.language IS NULL)             -- 言語
  AND p.is_reblog = 0                                          -- ブースト除外
  AND p.in_reply_to_uri IS NULL                                -- リプライ除外
  AND <muted_accounts サブクエリ>                               -- ミュート
  AND <blocked_instances サブクエリ>                             -- ブロック
```

## UI ↔ Advanced Query の相互変換

`TimelineEditPanel` では UI モードと Advanced Query モードを切り替えられる。

### UI → Advanced Query

UI のフィルタ設定を `queryBuilder.ts` の `buildQueryFromConfig()` が SQL WHERE 句に変換する。

```
UI: type=public, onlyMedia=true, languageFilter=['ja']
    ↓
SQL: ptt.timelineType = 'public' AND EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id) AND (p.language IN ('ja') OR p.language IS NULL)
```

### Advanced Query → UI

Advanced Query から UI モードに戻す場合、`parseQueryToConfig()` がベストエフォートで SQL を解析し `Partial<TimelineConfigV2>` を抽出する。`canParseQuery()` でラウンドトリップの忠実度を検証し、復元できない場合はパース警告を表示する。

## パフォーマンス考慮

### サブクエリ vs JOIN

v2 スキーマではメディアや可視性のフィルタにサブクエリを使用する。`post_media` や `visibility_types` は 1:N ではなく 1:1 に近い関係のため、サブクエリのコストは低い。一方で posts テーブルの非正規化カラムを減らし、テーブル設計がクリーンになった。

### NOT EXISTS vs LEFT JOIN + IS NULL

ミュートとインスタンスブロックには `NOT EXISTS` サブクエリを使用。`LEFT JOIN ... WHERE ... IS NULL` よりも SQLite のクエリオプティマイザに適している場合が多い。

### ChangeHint による選択的再クエリ

フィルタが変更されなくてもストリーミングでデータが到着すると再クエリが走る。`ChangeHint` により、自パネルに関係しない変更（異なる backendUrl や timelineType）では再クエリをスキップし、不要なクエリ実行を削減する。
