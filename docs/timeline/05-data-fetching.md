# 05. クエリシステム

## 概要

UI がデータベースから投稿を取得する仕組み。**グラフ実行エンジン**（QueryPlanV2）が DAG として定義されたクエリグラフを Worker 内で実行し、最終的に **2 フェーズクエリ戦略** で詳細データを取得する。

## グラフ実行エンジン (QueryPlanV2)

### アーキテクチャ

```
TimelineConfigV2 → configToQueryPlanV2() → QueryPlanV2 (DAG)
                                              ↓
                              Worker: executeGraphPlan()
                                              ↓
                          DAG トポロジカルソート → ノード順次実行
                                              ↓
                          GetIds → LookupRelated → Merge → Output
                                              ↓
                          Output: Phase2 + Phase3 バッチクエリ
                                              ↓
                          NodeOutputRow[] → UI Hook
```

### ノード種別

| ノード | 役割 | 入力 | 出力 |
|---|---|---|---|
| GetIds | テーブルからフィルタ付き ID 取得 | フィルタ条件 | `[{id, createdAtMs}]` |
| LookupRelated | 関連テーブルへの相関検索 | 上流 ID | `[{id, createdAtMs}]` |
| MergeV2 | 複数ソースの結合 | 複数上流 | `[{id, createdAtMs}]` (interleave/union/intersect) |
| OutputV2 | ソート・ページネーション・詳細取得 | 上流 ID | Phase2/Phase3 結果 |

### WorkerNodeCache

Worker スレッド内でノード結果をキャッシュする。テーブルバージョン番号でキャッシュ無効化を管理し、上流ノードのハッシュ変更も検知する。

## 2 フェーズクエリ

### なぜ 2 フェーズか

投稿の完全なデータ（本文、メディア、プロフィール、絵文字、投票、リンクカード等）を取得するには多数の JOIN が必要で、全行に対してこの JOIN を実行するとコストが高い。

Phase 1: フィルタ付きで post_id のリストだけを取得（軽量）
Phase 2: 取得した post_id に対してのみ完全なデータを取得（バッチクエリ）

### fetchTimeline バッチ API

`useFilteredTimeline` と `useFilteredTagTimeline` は `handle.fetchTimeline()` を使用して、Phase 1 → Phase 2 → バッチクエリ（子テーブル×7）を Worker 内で一括実行する。

const result = await handle.fetchTimeline({
  phase1: { sql: phase1Sql, bind: phase1Binds },
  phase2BaseSql: PHASE2_BASE_TEMPLATE,
  batchSqls: buildScopedBatchTemplates(targetBackendUrls),
}, sessionTag)

// result = {
//   phase1Rows, phase2Rows, batchResults,
//   totalDurationMs
// }

**セッションタグ**: 同一タイムラインの前回クエリが未完了の場合、新しいリクエストがインプレース置換でキャンセルする。

### Phase 1（ID 収集）

タイムライン種別ごとに `timeline_entries` テーブルを JOIN して post_id を収集する。

SELECT p.id,
       json_group_array(DISTINCT te.timeline_key) AS timelineTypes,
       MIN(la.backend_url) AS backendUrl
FROM timeline_entries te
INNER JOIN posts p ON p.id = te.post_id
LEFT JOIN post_backend_ids pbi ON p.id = pbi.post_id
LEFT JOIN local_accounts la ON pbi.local_account_id = la.id
LEFT JOIN profiles pr ON p.author_profile_id = pr.id
WHERE la.backend_url IN (?, ?)
  -- フィルタ条件（buildFilterConditions で生成）
  AND EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)
  AND (SELECT name FROM visibility_types WHERE id = p.visibility_id) IN ('public', 'unlisted')
GROUP BY p.id
HAVING MAX(te.timeline_key = ?) = 1
ORDER BY p.created_at_ms DESC
LIMIT 50

特徴:
- `timeline_entries` を起点に投稿をフィルタ
- `HAVING MAX(te.timeline_key = ?) = 1` で特定のタイムラインタイプに限定
- `local_accounts` 経由で `backend_url` を解決
- `SELECT p.id` のみ（+ 集約カラムを少数追加）
- インデックスが効くカラムでフィルタ
- `LIMIT` で取得件数を制限

### Phase 2 + バッチ（詳細取得）

Phase 1 で取得した post_id に対して、Phase 2 で基本データを取得し、7 つのバッチクエリで子テーブルデータを並列取得する。

**Phase 2**: STATUS_BASE_SELECT + STATUS_BASE_JOINS で基本カラムを取得
**バッチクエリ**: post_media, post_stats, post_hashtags, post_mentions, post_custom_emojis, profile 関連, post_interactions 等

結果は `assembleStatusFromBatch()` と `buildBatchMapsFromResults()` で `SqliteStoredStatus` オブジェクトに組み立てられる。

## テーブルエイリアス

### エイリアス一覧

Advanced Query でユーザーが WHERE 句を記述する際に使用するエイリアス。`detectReferencedAliases()` がこれらを検出し、参照されているテーブルのみを動的に JOIN する。

| エイリアス | テーブル名 | 検出パターン | 備考 |
|-----------|-----------|------------|------|
| `p` | `posts` | 全クエリで常に存在 | サブクエリ経由ではなく直接参照 |
| `pb` | `post_backend_ids` + `local_accounts` | `\bpb\.\w+` | 参照時のみ JOIN |
| `ptt` | `timeline_entries` | `\bptt\.\w+` | 参照時のみ JOIN |
| `pbt` / `pht` | `post_hashtags` + `hashtags` | `\b(pbt\|pht)\.\w+` | 参照時のみ JOIN |
| `ht` | `hashtags` | `\bht\.\w+` | 参照時のみ JOIN |
| `pme` | `post_mentions` | `\bpme\.\w+` | 参照時のみ JOIN |
| `prb` | posts_reblogs 互換サブクエリ | `\bprb\.\w+` | 参照時のみ JOIN |
| `pe` | `post_interactions` | `\bpe\.\w+` | 参照時のみ JOIN |
| `pr` | `profiles` | `\bpr\.\w+` | 参照時のみ JOIN |
| `vt` | `visibility_types` | `\bvt\.\w+` | 参照時のみ JOIN |
| `ps` | `post_stats` | `\bps\.\w+` | 参照時のみ JOIN |
| `n` / `nt` / `ap` | `notifications` + 関連テーブル | `\b(n\|nt\|ap)\.\w+` | 通知クエリ用 |

### 動的 JOIN の制御

`detectReferencedAliases()` が WHERE 句中のエイリアス参照パターンを検出し、実際に参照されているテーブルのみを JOIN する。不要な JOIN を省くことでクエリプランを最適化する。

## フィルタビルダー

`statusFilter.ts` の `buildFilterConditions()` が `TimelineConfigV2` を SQL WHERE 句に変換する。

### 入力

function buildFilterConditions(
  config: TimelineConfigV2,
  targetBackendUrls: string[],
  tableAlias: string = 'p',
  options?: {
    profileJoined?: boolean
  }
): { conditions: string[], binds: (string | number)[] }

### フィルタ → SQL 変換

| フィルタ | 生成される SQL |
|---------|---------------|
| `onlyMedia: true` | `EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)` |
| `minMediaCount: 3` | `(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= 3` |
| `visibilityFilter: ['public', 'unlisted']` | `(SELECT name FROM visibility_types WHERE id = p.visibility_id) IN ('public', 'unlisted')` |
| `languageFilter: ['ja', 'en']` | `(p.language IN ('ja', 'en') OR p.language IS NULL)` |
| `excludeReblogs: true` | `p.is_reblog = 0` |
| `excludeReplies: true` | `p.in_reply_to_uri IS NULL` |
| `excludeSpoiler: true` | `p.spoiler_text = ''` |
| `excludeSensitive: true` | `p.is_sensitive = 0` |
| `accountFilter: { mode: 'include', accts: [...] }` | `(SELECT acct FROM profiles WHERE id = p.author_profile_id) IN (?, ?)` |
| `accountFilter: { mode: 'exclude', accts: [...] }` | `(SELECT acct FROM profiles WHERE id = p.author_profile_id) NOT IN (?, ?)` |
| `applyMuteFilter: true` | `buildMuteCondition()` のサブクエリ |
| `applyInstanceBlock: true` | `buildInstanceBlockCondition()` のサブクエリ |
| `followsOnly: true` | **未実装**（v2 スキーマに follows テーブルなし、警告ログ出力） |

**注意**: `accountFilter.mode === 'include'` の場合、ミュートフィルタは **スキップ** される（明示的にユーザーを指定した場合にミュートで消えるのは不適切なため）。

### バインド変数

SQL インジェクション防止のため、ユーザー入力値はバインド変数（`?` プレースホルダ）として渡される。

## Advanced Query

### 概要

`customQuery` が非空のタイムラインでは、ユーザーが SQL WHERE 句を直接記述できる。`useCustomQueryTimeline` がこれを処理する。

### サニタイズ

入力される SQL に対して以下の安全対策を適用：

// 禁止: DML/DDL/管理コマンド
const forbidden = /\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i

// SQL コメントの拒否（backendUrl 条件のコメントアウト防止）
if (/--/.test(query) || /\/\*/.test(query)) { reject }

// 除去: セミコロン、LIMIT/OFFSET
query = query
  .replace(/;/g, '')
  .replace(/\bLIMIT\b\s+\d+/gi, '')
  .replace(/\bOFFSET\b\s+\d+/gi, '')
  .trim()

// ? プレースホルダの禁止（バインド競合防止、文字列リテラル内は許可）
hasUnquotedQuestionMark(query) → reject

// v1 → v2 構文アップグレード
upgradeQueryToV2(query)

### クエリ種別の自動判定

カスタム SQL 内のテーブルエイリアス参照を `detectReferencedAliases()` で解析して、クエリ種別を判定する。

| 判定結果 | 条件 | 処理 |
|---------|------|------|
| status-only | `p.*` 系のみ参照 | 2 フェーズクエリ |
| notification-only | `n.*` / `nt.*` / `ap.*` のみ参照 | 通知テーブルの 1 フェーズクエリ |
| mixed | 両方参照 | 投稿と通知を別々に取得してマージ |

### 施策 A: サブクエリ廃止

旧実装では `posts` テーブルを互換カラム付きサブクエリでラップしていたが、`rewriteLegacyColumnsForPhase1()` で旧カラム名を正規化形式に直接書き換える方式に変更。サブクエリのオーバーヘッドを排除。

### 施策 D: profile_id ヒント注入

`injectProfileIdHint()` が相関サブクエリ内の `profiles.acct` 比較を検出し、冗長な `actor_profile_id = p.author_profile_id` 条件を注入。通知テーブルのインデックス（`notification_type_id, actor_profile_id, created_at_ms DESC`）が効くようになる。

### 施策 E: アクター事前フィルタ

相関サブクエリが `notifications` テーブルを参照する場合、マッチする `actor_profile_id` を事前取得して外側スキャン行数を削減。500 件以内の場合に `IN (...)` 条件として注入。

### Mixed Query の処理

投稿と通知を **同じタイムラインに時系列で混合表示** する場合：

1. Notification Phase 1: カスタム WHERE を notifications に適用 → ID + created_at_ms を取得
2. 通知が queryLimit 件以上の場合、最古の created_at_ms を Status Phase 1 の時間下限に使用（スキャン範囲削減）
3. Status Phase 1: カスタム WHERE を posts に適用 → ID + created_at_ms を取得
4. 両結果を `created_at_ms` でマージソートし上位 queryLimit 件を選定
5. 選定された ID に対して Phase 2 を実行
6. 各アイテムに `_type: 'status' | 'notification'` を付与して判別

### バージョンカウンタによる競合防止

非同期クエリの実行中に設定が変更された場合、古いクエリ結果を破棄する。

const versionRef = useRef(0)
const currentVersion = ++versionRef.current
const results = await execAsync(sql)
if (versionRef.current !== currentVersion) return  // 古い結果は破棄

## ページネーション（loadMore）

各 Hook は `loadMore()` 関数を公開し、`UnifiedTimeline` の Virtuoso が末尾到達時に呼び出す。

ユーザースクロール
    ↓
Virtuoso endReached
    ↓
loadMore()  → SQLite LIMIT を拡張
    ↓
DB 内にデータあり → 即座に表示
DB 内のデータ枯渇 → fetchMoreData() で API から追加取得
    ↓
bulkUpsert → notifyChange → 再クエリ → UI 自動更新

### 2 段階のページネーション

1. **DB 内ページネーション**: `queryLimit` を `TIMELINE_QUERY_LIMIT` 分ずつ増加させ、SQLite に既に格納されたデータの中で次のページを取得
2. **API ページネーション**: DB 上のタイムラインタイプに紐づく最古 ID を取得し、`max_id` ベースで API から追加データを取得して SQLite に格納

### バックエンドごとの枯渇追跡

`UnifiedTimeline` は各 `backendUrl` ごとにデータ枯渇状態を追跡する。

const exhaustedBackendsRef = useRef(new Set<string>())

あるバックエンドの `fetchMoreData()` が `FETCH_LIMIT` 未満の件数を返した場合、そのバックエンドを枯渇としてマークし、以降のページネーションリクエストから除外する。
