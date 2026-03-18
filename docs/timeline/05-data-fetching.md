# 05. クエリシステム

## 概要

UI がデータベースから投稿を取得する仕組み。パフォーマンスのために **2 フェーズクエリ戦略** を採用し、フィルタ条件は `timelineFilterBuilder` が SQL に変換する。

## 2 フェーズクエリ

### なぜ 2 フェーズか

投稿の完全なデータ（本文、メディア、プロフィール、絵文字、投票、リンクカード等）を取得するには多数の JOIN が必要で、全行に対してこの JOIN を実行するとコストが高い。

```
Phase 1: フィルタ付きで post_id のリストだけを取得（軽量）
Phase 2: 取得した post_id に対してのみ完全な JOIN を実行（詳細）
```

### Phase 1（ID 収集）

タイムライン種別ごとに対応するテーブルを JOIN して post_id を収集する。以下は `getStatusesByTimelineType` の例：

```sql
SELECT p.post_id, json_group_array(DISTINCT ck.code) AS timelineTypes
FROM posts p
INNER JOIN posts_backends pb ON p.post_id = pb.post_id
INNER JOIN posts_timeline_types ptt ON p.post_id = ptt.post_id
LEFT JOIN timeline_items ti ON p.post_id = ti.post_id
LEFT JOIN timelines t ON t.timeline_id = ti.timeline_id
LEFT JOIN channel_kinds ck ON t.channel_kind_id = ck.channel_kind_id
WHERE ptt.timelineType = ?
  AND pb.backendUrl IN (?, ?)
  -- フィルタ条件（timelineFilterBuilder で生成）
  AND p.has_media = 1
  AND p.visibility_id IN (SELECT visibility_id FROM visibility_types WHERE code IN ('public', 'unlisted'))
GROUP BY p.post_id
ORDER BY p.created_at_ms DESC
LIMIT 50
```

Advanced Query（カスタムクエリ）の場合は、後方互換カラムをサブクエリで付与したうえで `p` エイリアスを付ける（詳細は後述の「テーブルエイリアス」節を参照）：

```sql
SELECT DISTINCT p.post_id
FROM (
  SELECT p_inner.*,
    COALESCE((SELECT sv.base_url FROM servers sv WHERE sv.server_id = p_inner.origin_server_id), '') AS origin_backend_url,
    COALESCE((SELECT pr2.acct FROM profiles pr2 WHERE pr2.profile_id = p_inner.author_profile_id), '') AS account_acct,
    COALESCE((SELECT vt2.code FROM visibility_types vt2 WHERE vt2.visibility_id = p_inner.visibility_id), 'public') AS visibility,
    COALESCE((SELECT ps2.favourites_count FROM post_stats ps2 WHERE ps2.post_id = p_inner.post_id), 0) AS favourites_count,
    COALESCE((SELECT ps2.reblogs_count FROM post_stats ps2 WHERE ps2.post_id = p_inner.post_id), 0) AS reblogs_count,
    COALESCE((SELECT ps2.replies_count FROM post_stats ps2 WHERE ps2.post_id = p_inner.post_id), 0) AS replies_count
  FROM posts p_inner
) p
LEFT JOIN posts_backends pb ON p.post_id = pb.post_id
LEFT JOIN posts_timeline_types ptt ON p.post_id = ptt.post_id  -- WHERE 句が参照する場合のみ JOIN
WHERE (ユーザーが記述した WHERE 句)
  AND pb.backendUrl IN (?, ?)
ORDER BY p.created_at_ms DESC
LIMIT ? OFFSET ?
```

特徴:
- `SELECT DISTINCT p.post_id` のみ（または集約カラムを少数追加）
- 最小限の JOIN（フィルタに必要なテーブルのみ）
- インデックスが効くカラムでフィルタ
- `LIMIT` で取得件数を制限

### Phase 2（詳細取得）

`fetchStatusesByIds()` が Phase 1 で取得した post_id に対して完全な JOIN を実行する。

```sql
SELECT
  p.post_id, p.object_uri, p.content_html, p.created_at_ms,
  pr.acct, pr.display_name, pr.avatar_url,
  vt.code AS visibility,
  -- メディア（json_group_array で集約）
  json_group_array(DISTINCT json_object(
    'id', pm.remote_media_id, 'type', mt.code,
    'url', pm.url, 'preview_url', pm.preview_url,
    'description', pm.description, 'blurhash', pm.blurhash
  )) AS media_attachments,
  -- エンゲージメント
  group_concat(DISTINCT et.code) AS engagement_types,
  -- メンション、ハッシュタグ、絵文字...
FROM posts p
LEFT JOIN posts_backends pb ON pb.post_id = p.post_id
LEFT JOIN profiles pr ON pr.profile_id = p.author_profile_id
LEFT JOIN visibility_types vt ON vt.visibility_id = p.visibility_id
LEFT JOIN post_stats ps ON ps.post_id = p.post_id
LEFT JOIN post_engagements pe ON pe.post_id = p.post_id
LEFT JOIN engagement_types et ON et.engagement_type_id = pe.engagement_type_id
LEFT JOIN post_media pm ON pm.post_id = p.post_id
LEFT JOIN media_types mt ON mt.media_type_id = pm.media_type_id
LEFT JOIN posts_mentions pme ON pme.post_id = p.post_id
LEFT JOIN posts_belonging_tags pbt ON pbt.post_id = p.post_id
LEFT JOIN post_custom_emojis pce ON pce.post_id = p.post_id
LEFT JOIN custom_emojis ce ON ce.emoji_id = pce.emoji_id
LEFT JOIN polls pl ON pl.post_id = p.post_id
LEFT JOIN poll_options po ON po.poll_id = pl.poll_id
WHERE p.post_id IN (?, ?, ?, ...)  -- Phase 1 で取得した ID
GROUP BY p.post_id
ORDER BY p.created_at_ms DESC
```

特徴:
- `WHERE p.post_id IN (...)` で対象を限定
- `json_group_array` / `group_concat` で 1:N 関係を集約
- `GROUP BY p.post_id` で投稿ごとに 1 行に
- 結果を `rowToStoredStatus()` で `SqliteStoredStatus` オブジェクトに変換

## テーブルエイリアス

### エイリアス一覧

Advanced Query でユーザーが WHERE 句を記述する際に使用するエイリアス。`detectReferencedAliases()` がこれらを検出し、参照されているテーブルのみを動的に JOIN する。

| エイリアス | テーブル名 | 由来 | 備考 |
|-----------|-----------|------|------|
| `p` | `posts` | **p**osts | 全クエリで常に存在 |
| `pb` | `posts_backends` | **p**osts_**b**ackends | 全クエリで常に JOIN |
| `ptt` | `posts_timeline_types` | **p**osts **t**imeline **t**ypes | 参照時のみ JOIN |
| `pbt` | `posts_belonging_tags` | **p**osts **b**elonging **t**ags | 参照時のみ JOIN |
| `pme` | `posts_mentions` | **p**osts **me**ntions | 参照時のみ JOIN |
| `prb` | `posts_reblogs` | **p**osts **r**e**b**logs | 参照時のみ JOIN |
| `pe` | `post_engagements` | **p**ost **e**ngagements | 参照時のみ JOIN |
| `n` | `notifications` | **n**otifications | 通知クエリ用 |

### エイリアスが必要な理由

1. **サブクエリに対する構文上の要件**: Advanced Query では `posts` テーブルを直接参照せず、後方互換カラム（`account_acct`, `visibility`, `favourites_count` 等）を追加するサブクエリを `p` として参照する。SQL の仕様上、サブクエリの結果セットにはエイリアスが必須。

2. **Advanced Query の公開 API**: ユーザーは `p.has_media = 1` や `pbt.tag = 'art'` のようにエイリアスを使って WHERE 句を記述する。エイリアスは UI の補完候補（`QUERY_COMPLETIONS`）にも定義されており、ユーザー向けインターフェースの一部。

3. **動的 JOIN の制御**: `detectReferencedAliases()` が WHERE 句中のエイリアス参照パターン（例: `\bpbt\.\w+`）を検出し、実際に参照されているテーブルのみを JOIN する。不要な JOIN を省くことで `GROUP BY` / `ORDER BY` の一時 B-Tree を削減する。

### Phase 2 のエイリアス

Phase 2（`fetchStatusesByIds`）ではサブクエリを使わず `FROM posts p` と直接エイリアスを付けている。Phase 2 はフィルタ済みの post_id に対して実行するだけなので後方互換カラムは不要であり、サブクエリ構文上の必要性はない。ここでの `p` は Phase 1 との一貫性のために使用されている。

## フィルタビルダー

`timelineFilterBuilder.ts` の `buildFilterConditions()` が `TimelineConfigV2` を SQL WHERE 句に変換する。

### 入力

```typescript
function buildFilterConditions(
  config: TimelineConfigV2,
  targetBackendUrls: string[],
  tableAlias: string = 'p',  // posts テーブルのエイリアス
  options?: {
    profileJoined?: boolean   // profiles テーブルが pr として JOIN されている場合 true
  }
): { conditions: string[], binds: (string | number)[] }
```

`tableAlias` のデフォルトは `'p'`。Phase 1 のクエリではサブクエリ結果を `p` として参照するため `'p'` を使う。

### フィルタ → SQL 変換

| フィルタ | 生成される SQL |
|---------|---------------|
| `onlyMedia: true` | `p.has_media = 1` |
| `minMediaCount: 3` | `p.media_count >= 3` |
| `visibilityFilter: ['public', 'unlisted']` | `p.visibility_id IN (SELECT visibility_id FROM visibility_types WHERE code IN ('public', 'unlisted'))` |
| `languageFilter: ['ja', 'en']` | `p.language IN ('ja', 'en')` |
| `excludeReblogs: true` | `p.is_reblog = 0` |
| `excludeReplies: true` | `p.in_reply_to_id IS NULL` |
| `excludeSpoiler: true` | `p.has_spoiler = 0` |
| `excludeSensitive: true` | `p.is_sensitive = 0` |
| `accountFilter: { mode: 'include', accts: [...] }` | `pr.acct IN (?, ?)` |
| `accountFilter: { mode: 'exclude', accts: [...] }` | `pr.acct NOT IN (?, ?)` |
| `applyMuteFilter: true` | `NOT EXISTS (SELECT 1 FROM muted_accounts ma WHERE ma.account_acct = pr.acct AND ma.backendUrl = pb.backendUrl)` |
| `applyInstanceBlock: true` | `NOT EXISTS (SELECT 1 FROM blocked_instances bi WHERE pr.domain = bi.instance_domain)` |
| `followsOnly: true` | `EXISTS (SELECT 1 FROM follows f WHERE f.target_profile_id = p.author_profile_id)` |

### バインド変数

SQL インジェクション防止のため、すべてのユーザー入力値はバインド変数（`?` プレースホルダ）として渡される。

## Advanced Query

### 概要

`advancedQuery: true` のタイムラインでは、ユーザーが SQL WHERE 句を直接記述できる。`getStatusesByCustomQuery()` がこれを処理する。

### サニタイズ

入力される SQL に対して以下の安全対策を適用：

```typescript
// 禁止: DML/DDL
if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE)\b/i.test(query)) {
  throw new Error('DML/DDL statements are not allowed')
}

// 除去: セミコロン、LIMIT/OFFSET、コメント
query = query
  .replace(/;/g, '')
  .replace(/\bLIMIT\s+\d+/gi, '')
  .replace(/\bOFFSET\s+\d+/gi, '')
  .replace(/--.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
```

### クエリ種別の自動判定

カスタム SQL 内のテーブルエイリアス参照を `detectReferencedAliases()` で解析して、クエリ種別を判定する。

```typescript
// detectReferencedAliases() が検出するエイリアス
p   → posts（サブクエリ経由）
ptt → posts_timeline_types
pbt → posts_belonging_tags
pme → posts_mentions
pb  → posts_backends
prb → posts_reblogs
pe  → post_engagements
n   → notifications
```

| 判定結果 | 条件 | 処理 |
|---------|------|------|
| status-only | `p.*` 系のみ参照 | 通常の 2 フェーズクエリ |
| notification-only | `n.*` のみ参照 | 通知テーブルの 1 フェーズクエリ |
| mixed | 両方参照 | 投稿と通知を別々に取得して UNION |

### Mixed Query の処理

投稿と通知を **同じタイムラインに時系列で混合表示** する場合：

1. 投稿クエリ: カスタム WHERE を posts テーブルに適用 → 2 フェーズ
2. 通知クエリ: カスタム WHERE を notifications テーブルに適用 → 1 フェーズ
3. 結果を `created_at_ms` でマージソート
4. 各アイテムに `_type: 'status' | 'notification'` を付与して判別

### バージョンカウンタによる競合防止

非同期クエリの実行中に設定が変更された場合、古いクエリ結果を破棄する。

```typescript
const versionRef = useRef(0)

// クエリ実行前にバージョンをインクリメント
const currentVersion = ++versionRef.current

// 結果到着時にバージョンを照合
const results = await execAsync(sql)
if (versionRef.current !== currentVersion) return  // 古い結果は破棄
```

## ページネーション（loadMore）

各 Hook は `loadMore()` 関数を公開し、`UnifiedTimeline` の Virtuoso が末尾到達時に呼び出す。

```
ユーザースクロール
    ↓
Virtuoso endReached
    ↓
loadMore()
    ↓
Phase 1 で OFFSET 付きクエリ or max_id ベース
    ↓
結果をステートに追加
    ↓
必要なら fetchMoreData() で API から追加取得
```

### 2 段階のページネーション

1. **DB 内ページネーション**: SQLite に既に格納されたデータの中で次のページを取得
2. **API ページネーション**: DB 内のデータが枯渇した場合、API から追加データを取得して SQLite に格納 → 再クエリ

### バックエンドごとの枯渇追跡

`UnifiedTimeline` は各 `backendUrl` ごとにデータ枯渇状態を追跡する。

```typescript
const [exhaustedBackends, setExhaustedBackends] = useState<Set<string>>(new Set())
```

あるバックエンドの `fetchMoreData()` が `FETCH_LIMIT` 未満の件数を返した場合、そのバックエンドを枯渇としてマークし、以降のページネーションリクエストから除外する。
