# Query IRシステム

miyulab-fe のタイムラインデータ取得は、ユーザー設定（`TimelineConfigV2`）から直接 SQL を生成するのではなく、**Query IR（中間表現）** を経由するパイプラインで構成されている。本ドキュメントでは Query IR の設計思想、ノード定義、コンパイルパイプライン、実行エンジンについて解説する。

---

## 目次

1. [設計思想](#設計思想)
2. [パイプライン概要](#パイプライン概要)
3. [ノード定義 (V2)](#ノード定義-v2)
4. [フィルタ型 (V1)](#フィルタ型-v1)
5. [実行計画 (ExecutionPlan)](#実行計画-executionplan)
6. [コンパイルパイプライン](#コンパイルパイプライン)
7. [2フェーズクエリ戦略](#2フェーズクエリ戦略)
8. [レジストリ (TABLE_REGISTRY)](#レジストリ-table_registry)
9. [Executor](#executor)
10. [カーソルプッシュダウン最適化](#カーソルプッシュダウン最適化)
11. [FlowEditor との連携](#floweditor-との連携)
12. [次に読むべきドキュメント](#次に読むべきドキュメント)

---

## 設計思想

### なぜ直接 SQL 生成ではなく IR を経由するのか

1. **関心の分離**: ユーザー設定のセマンティクスと SQL の詳細を分離する。`TimelineConfigV2` は「何を見たいか」を宣言的に表現し、IR は「どうデータを集めるか」をグラフ構造で記述する。SQL はその実行手段に過ぎない。

2. **最適化の余地**: IR レベルでカーソルプッシュダウン、テーブル依存解析、JOIN 戦略選択などの最適化を適用できる。直接 SQL を生成すると、これらの変換が文字列操作になり危険。

3. **検証とデバッグ**: IR は構造化されたデータであるため、バリデーション（`validate.ts`）やビジュアルデバッグ（FlowEditor）が容易。

4. **バージョン進化**: V1（フラットな QueryPlan）から V2（DAG ベースの QueryPlanV2）への進化が IR 層の変更だけで実現できた。UI やエグゼキュータは段階的に移行可能。

---

## パイプライン概要

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐     ┌──────────────┐
│ TimelineConfigV2 │────▶│ configToQueryPlan │────▶│ QueryPlanV2 │────▶│ graphExecutor│
│  (ユーザー設定)   │     │       V2          │     │  (IR グラフ)  │     │  (Worker内)   │
└─────────────────┘     └──────────────────┘     └─────────────┘     └──────┬───────┘
                                                                           │
                        ┌──────────────────────────────────────────────────┘
                        ▼
              ┌─────────────────┐     ┌──────────────────┐     ┌────────────────┐
              │ Phase 1: ID収集  │────▶│ Phase 2: 詳細取得  │────▶│ Phase 3: バッチ │
              │ (get-ids → SQL) │     │ (JOINリッチSQL)    │     │ (メディア等)    │
              └─────────────────┘     └──────────────────┘     └────────────────┘
```

### V1 → V2 の進化

| 項目 | V1 (QueryPlan) | V2 (QueryPlanV2) |
|------|-----------------|-------------------|
| 構造 | フラット（source + filters + composites） | DAG グラフ（nodes + edges） |
| ノード型 | SourceNode, FilterNode, CompositeNode | GetIdsNode, LookupRelatedNode, MergeNodeV2, OutputNodeV2 |
| 複数ソース | MergeNode（composites 内） | merge-v2 ノードへの複数エッジ |
| 関連検索 | なし | lookup-related ノード |
| 識別 | `version` フィールドなし | `version: 2` |

---

## ノード定義 (V2)

> ソースファイル: `src/util/db/query-ir/nodes.ts`（207行目以降）

QueryPlanV2 は DAG（有向非巡回グラフ）として表現される。

```typescript
type QueryPlanV2 = {
  version: 2
  nodes: QueryPlanV2Node[]   // { id: string, node: QueryNodeV2 }
  edges: QueryPlanV2Edge[]   // { source: string, target: string }
}
```

### 主要ノード型

| ノード kind | 型名 | 役割 | 入力 | 出力 |
|------------|------|------|------|------|
| `get-ids` | `GetIdsNode` | テーブルからフィルタ済み ID リストを取得 | なし（ルートノード）or 上流ノードの ID | `NodeOutputRow[]` ({table, id, createdAtMs}) |
| `lookup-related` | `LookupRelatedNode` | 上流 ID から関連テーブルの ID を相関検索 | 上流の `NodeOutput` | `NodeOutputRow[]` |
| `merge-v2` | `MergeNodeV2` | 複数ソースの ID リストを統合 | 複数の `NodeOutput` | `NodeOutputRow[]` |
| `output-v2` | `OutputNodeV2` | ソート・ページネーション・Phase2/3 実行 | 単一の `NodeOutput` | `GraphExecuteResult` |

### GetIdsNode の詳細

```typescript
type GetIdsNode = {
  kind: 'get-ids'
  table: string                    // ソーステーブル名
  filters: GetIdsFilter[]          // AND 結合されるフィルタ群
  orBranches?: GetIdsFilter[][]    // OR 分岐（各ブランチ内は AND）
  outputIdColumn?: string          // 出力 ID カラム（デフォルト: 'id'）
  outputTimeColumn?: string | null // 出力時刻カラム（null = 時刻なし）
  cursor?: {                       // カーソル条件（patchPlanForFetch で注入）
    column: string
    op: '<' | '>'
    value: number
  }
}
```

`GetIdsFilter` は以下の2つの union 型:

| 型 | 説明 | 例 |
|----|------|----|
| `FilterCondition` | 単一カラムのフィルタ条件 | `{table: 'posts', column: 'language', op: 'IN', value: ['ja']}` |
| `ExistsCondition` | 行の存在/件数チェック | `{table: 'post_media', mode: 'exists'}` |

`FilterCondition` は `upstreamSourceNodeId` フィールドを持ち、上流ノードの出力 ID を値として動的に注入できる。

### LookupRelatedNode の詳細

```typescript
type LookupRelatedNode = {
  kind: 'lookup-related'
  lookupTable: string                // 検索先テーブル
  joinConditions: JoinCondition[]    // 結合条件
  timeCondition?: TimeCondition      // 時間窓フィルタ（per-row 相関）
  aggregate?: AggregateMode          // 集約（MIN/MAX）
  perLimit?: number                  // 入力行あたりの取得上限
  perLimitOrder?: 'nearest' | 'furthest'  // perLimit 時の順序
}
```

`joinConditions` の `resolveIdentity` フラグが有効な場合、`profiles.canonical_acct` を介してマルチアカウント環境での同一人物解決を行う。

### MergeNodeV2 の詳細

```typescript
type MergeNodeV2 = {
  kind: 'merge-v2'
  strategy: 'union' | 'intersect' | 'interleave-by-time'
  limit: number
}
```

| strategy | 動作 |
|----------|------|
| `union` | 全入力の和集合（`(table, id)` で重複排除、`createdAtMs` DESC） |
| `intersect` | 全入力の共通集合 |
| `interleave-by-time` | `createdAtMs` 降順で全入力をインターリーブ（重複排除あり） |

### OutputNodeV2 の詳細

```typescript
type OutputNodeV2 = {
  kind: 'output-v2'
  sort: { field: string; direction: 'ASC' | 'DESC' }
  pagination: {
    limit: number
    offset?: number
    cursor?: PaginationCursor
  }
}
```

`PaginationCursor` はカーソルベースページネーションを実現する:

```typescript
type PaginationCursor = {
  field: 'created_at_ms' | 'id'
  value: number
  direction: 'before' | 'after'  // before=古い方, after=新しい方
}
```

---

## フィルタ型 (V1)

> ソースファイル: `src/util/db/query-ir/nodes.ts`（1〜206行目）

V1 の `FilterNode` は V2 の `GetIdsFilter` とは別体系で、以下の union 型:

| kind | 型名 | 用途 |
|------|------|------|
| `table-filter` | `TableFilter` | 汎用カラムフィルタ（`=`, `IN`, `LIKE` 等） |
| `exists-filter` | `ExistsFilter` | 行の存在/件数チェック（`exists`, `not-exists`, `count-gte` 等） |
| `backend-filter` | `BackendFilter` | バックエンドスコープ（`localAccountIds` で絞込み） |
| `moderation-filter` | `ModerationFilter` | ミュート・インスタンスブロック |
| `timeline-scope` | `TimelineScope` | タイムラインエントリスコープ（`INNER JOIN` を駆動） |
| `raw-sql-filter` | `RawSQLFilter` | 生 SQL エスケープハッチ |
| `aerial-reply-filter` | `AerialReplyFilter` | 空中リプライ検出（通知直後の投稿を時間窓で検出） |
| `or-group` | `OrGroup` | OR 分岐（各ブランチ内は AND） |

V1 フィルタは `compileFilterNode()`（`translate/filterToSql.ts`）で SQL に変換される。V2 の `GetIdsNode` 内部でも同じコンパイラが再利用されている。

---

## 実行計画 (ExecutionPlan)

> ソースファイル: `src/util/db/query-ir/plan.ts`

V1 コンパイラ（`compile.ts`）が生成する実行計画。V2 グラフ実行では直接使用されないが、概念的なフェーズ構造は共通。

### ステップの流れ

```
IdCollectStep(s)  →  MergeStep  →  DetailFetchStep  →  BatchEnrichStep
   Phase 1              ↑             Phase 2              Phase 3
                   (複数ソース時)
```

| ステップ型 | フェーズ | 説明 |
|-----------|---------|------|
| `IdCollectStep` | Phase 1 | `SELECT id, created_at_ms FROM ... WHERE ...` を実行して ID を収集 |
| `MergeStep` | - | 複数の IdCollectStep の結果を `interleave-by-time` で統合 |
| `DetailFetchStep` | Phase 2 | `{IDS}` プレースホルダに ID を埋めて詳細データを取得 |
| `BatchEnrichStep` | Phase 3 | media, mentions, emojis 等のバッチクエリを実行 |

### NodeOutputRow

各ノードの出力行の共通型:

```typescript
type NodeOutputRow = {
  table: string       // 所属テーブル（'posts' | 'notifications' 等）
  id: number          // 行 ID
  createdAtMs: number // 作成日時（ミリ秒）
}
```

---

## コンパイルパイプライン

### 1. Config → QueryPlanV2

> ソースファイル: `src/util/db/query-ir/configToQueryPlanV2.ts`

`configToQueryPlanV2()` が `TimelineConfigV2` から直接 `QueryPlanV2` を生成する。

```
TimelineConfigV2
    │
    ├── type='notification'  → GetIds(notifications) → Output
    ├── type='tag'           → GetIds(posts, hashtag EXISTS) → Output
    ├── type='home'/'local'  → GetIds(timeline_entries) → Output
    └── timelineTypes 複数    → GetIds×N → Merge → Output
```

生成されるフィルタの種類:
- **タイムラインスコープ**: `timeline_entries.timeline_key IN (...)` + アカウントスコープ
- **タグフィルタ**: `post_hashtags` / `hashtags` の `ExistsCondition`
- **コンテンツフィルタ**: メディア、公開範囲、言語、ブースト除外、リプライ除外、CW除外、センシティブ除外
- **モデレーション**: `muted_accounts` (NOT EXISTS) + `blocked_instances` (NOT EXISTS)
- **通知種別**: `notification_types.name IN (...)`

### 2. IR → SQL (V1 コンパイラ)

> ソースファイル: `src/util/db/query-ir/compile.ts`

`compileQueryPlan()` が V1 の `QueryPlan` を `ExecutionPlan` に変換する。

処理の流れ:
1. `translateSource()` でソーステーブルの FROM 句と ORDER BY を生成
2. 各フィルタを `compileFilterNode()` で WHERE 句 + JOIN 句 + bind 値に変換
3. `TagCombination` がある場合は `HAVING COUNT(DISTINCT ht.name) >= N` を生成
4. 1:N JOIN がある場合は `GROUP BY` を追加
5. JOIN を alias で重複排除
6. Phase 1 SQL を組み立て
7. Phase 2 / Phase 3 のステップを追加

### 3. シンボル解決

> ソースファイル: `src/util/db/query-ir/resolve.ts`

`resolveTableDependency()` がフィルタノードからテーブル依存関係を解析し、最適な JOIN 戦略を決定する。

| 戦略 | 条件 | 用途 |
|------|------|------|
| `direct` | フィルタテーブル = ソーステーブル | 直接 WHERE |
| `exists` | 1:N カーディナリティ or `preferExists` ヒント | EXISTS サブクエリ |
| `not-exists` | `exists-filter` の `not-exists` モード | NOT EXISTS サブクエリ |
| `scalar-subquery` | `lookup` カーディナリティ or `isSmallLookup` ヒント | スカラーサブクエリ |
| `inner-join` | `timeline-scope` フィルタ | INNER JOIN |

### 4. バリデーション

> ソースファイル: `src/util/db/query-ir/validate.ts`

`validateQueryPlan()` が QueryPlan 全体を検証する。

検証項目:
- ソーステーブルがレジストリに存在するか
- フィルタのテーブル・カラムがレジストリに存在するか
- テーブル間の JOIN パスが存在するか
- 値の型がカラムの型と一致するか（integer/text）
- `RawSQLFilter` に禁止 SQL キーワード（`DROP`, `DELETE`, `INSERT` 等）が含まれないか
- `ExistsFilter` の `count-*` モードに `countValue` が設定されているか

返り値は `{valid, errors, warnings}` の `ValidationResult` 型。

---

## 2フェーズクエリ戦略

### なぜ2フェーズに分けるのか

ブラウザ内 SQLite Wasm でのパフォーマンスを最大化するため。

| フェーズ | 目的 | SQL の特徴 |
|---------|------|-----------|
| **Phase 1: ID 収集** | 対象行の特定 | `SELECT id, created_at_ms` のみ。軽量な JOIN + フィルタ |
| **Phase 2: 詳細取得** | 表示データの取得 | `id IN (...)` で確定済み ID に対して JOIN リッチな SELECT |
| **Phase 3: バッチエンリッチ** | 付随データの取得 | media, mentions, emojis 等を ID バッチで一括取得 |

### パフォーマンス上の理由

1. **Phase 1 が軽量**: ID と時刻だけを SELECT するため、不要なカラムの読み込みを回避
2. **Reblog 展開**: Phase 2 で `reblog_of_post_id` を検出し、親投稿の ID を追加取得
3. **バッチ効率**: Phase 3 で全投稿 ID をまとめて 1 回のクエリで付随データを取得（N+1 問題の回避）
4. **キャッシュ効率**: Phase 1 の結果（ID リスト）はテーブルバージョンでキャッシュ無効化管理される

### Phase 3 のバッチクエリ種別

| キー | データ |
|------|--------|
| `media` | 添付メディア |
| `mentions` | メンション |
| `customEmojis` | カスタム絵文字 |
| `profileEmojis` | プロフィール絵文字 |
| `timelineTypes` | タイムライン種別 |
| `belongingTags` | ハッシュタグ |
| `polls` | アンケート |
| `interactions` | インタラクション（お気に入り、ブースト等） |

---

## レジストリ (TABLE_REGISTRY)

> ソースファイル: `src/util/db/query-ir/registry/`

### ディレクトリ構成

```
src/util/db/query-ir/registry/
├── index.ts            # TABLE_REGISTRY の統合エクスポート
├── types.ts            # 型定義（TableRegistryEntry, ColumnMeta 等）
├── source-tables.ts    # ソーステーブル（posts, notifications）
├── post-tables.ts      # 投稿関連テーブル（post_media, timeline_entries 等）
├── account-tables.ts   # アカウント関連テーブル（profiles, local_accounts 等）
└── lookup-tables.ts    # ルックアップテーブル（visibility_types, notification_types 等）
```

### TABLE_REGISTRY の構造

```typescript
type TableRegistryEntry = {
  table: string                              // テーブル名
  label: string                              // UI 表示名
  cardinality: '1:1' | '1:N' | 'N:1' | 'lookup'  // ソースに対する関係
  columns: Record<string, ColumnMeta>        // フィルタ可能なカラム
  joinPaths: {                               // ソーステーブルへの結合パス
    posts?: JoinPath
    notifications?: JoinPath
  }
  hints?: {                                  // コンパイラヒント
    isSmallLookup?: boolean    // スカラーサブクエリ向き
    preferExists?: boolean     // EXISTS サブクエリ優先
  }
}
```

### カーディナリティと JOIN 戦略

| Cardinality | 意味 | デフォルト戦略 |
|-------------|------|--------------|
| `1:1` | ソースと1対1 | `exists`（行膨張を回避） |
| `1:N` | ソースに対して複数行 | `exists` |
| `N:1` | 多対1 | `exists` |
| `lookup` | 小規模マスターテーブル | `scalar-subquery` |

### 登録テーブル一覧

**ソーステーブル** (`source-tables.ts`):
- `posts` — 投稿
- `notifications` — 通知

**投稿関連** (`post-tables.ts`):
- `timeline_entries`, `post_media`, `post_mentions`, `post_hashtags`, `hashtags`
- `post_custom_emojis`, `post_emoji_reactions`, `post_interactions`, `post_stats`
- `post_backend_ids`, `polls`, `poll_options`, `poll_votes`, `link_cards`

**アカウント関連** (`account-tables.ts`):
- `profiles`, `profile_stats`, `local_accounts`
- `muted_accounts`, `blocked_instances`

**ルックアップ** (`lookup-tables.ts`):
- `visibility_types`, `notification_types`, `media_types`, `card_types`, `servers`

---

## Executor

> ソースファイル: `src/util/db/query-ir/executor/`

### ディレクトリ構成

```
src/util/db/query-ir/executor/
├── graphExecutor.ts           # メインオーケストレータ
├── getIdsExecutor.ts          # get-ids ノード実行
├── lookupRelatedExecutor.ts   # lookup-related ノード実行
├── mergeExecutor.ts           # merge-v2 ノード実行（インメモリ）
├── outputExecutor.ts          # output-v2 ノード実行（Phase2/3）
├── flatFetchExecutor.ts       # ID リストから直接詳細取得
├── flatFetchAssembler.ts      # フラットデータからエンティティ組み立て
├── flatFetchTypes.ts          # FlatFetch 型定義
├── topoSort.ts                # DAG トポロジカルソート
├── workerNodeCache.ts         # テーブルバージョンベースキャッシュ
└── types.ts                   # 型定義
```

### graphExecutor.ts — 実行全体のオーケストレーション

`executeGraphPlan()` が Worker 内で `QueryPlanV2` を実行する中心関数。

```
1. ノードマップ構築
2. topoSort() でトポロジカルソート（Kahn のアルゴリズム、サイクル検出付き）
3. 各ノードを依存順に実行:
   ├── get-ids     → executeGetIds()
   ├── lookup-related → executeLookupRelated()
   ├── merge-v2    → executeMerge()
   └── output-v2   → executeOutput()     ← Phase2/3 はここで実行
4. 各ノードの出力を Map<string, NodeOutput> に保持
5. WorkerNodeCache でキャッシュヒット判定
6. GraphExecuteResult を返却
```

### getIdsExecutor.ts — ID 取得

`compileGetIds()` が `GetIdsNode` から SQL を生成する。

処理の流れ:
1. `GetIdsFilter` を V1 の `FilterNode` 形式に変換
2. `compileFilterNode()` で WHERE 句 + JOIN 句を生成
3. `upstreamSourceNodeId` がある場合は上流ノードの出力 ID を値として注入
4. OR ブランチを `(A AND B) OR (C AND D)` 形式に変換
5. カーソル条件（`cursor`）があれば WHERE に追加
6. `resolveOutputTable()` で出力テーブルを解決（例: `timeline_entries.post_id` → `posts`）

### lookupRelatedExecutor.ts — 関連テーブル解決

2つの実行モードを持つ:

| モード | 条件 | SQL パターン |
|--------|------|-------------|
| **JOIN ベース** | `timeCondition` あり & `resolve` なし | `JOIN src ON ... WHERE src.id IN (?) AND lt.time >= src.time` |
| **IN ベース** | `timeCondition` なし、または `resolve` あり | `WHERE lt.col IN (?) AND lt.time BETWEEN ? AND ?` |

`resolveIdentity` が有効な場合、`profiles.canonical_acct` を介した同一人物解決サブクエリを生成する。

`perLimit` が設定されている場合、`ROW_NUMBER() OVER (PARTITION BY ...)` で各入力行あたりの取得件数を制限する。

### mergeExecutor.ts — 複数ソースの統合

`executeMerge()` は **SQL を使わず**インメモリで動作する。

- `(table, id)` の複合キーで重複排除
- `strategy` に応じて union / intersect / interleave-by-time を実行
- `limit` で結果を切り詰め
- `sourceTable` を rows から推定（全行同一テーブル → そのテーブル、混在 → `'mixed'`）

### outputExecutor.ts — 最終出力

`executeOutput()` が Phase 2 / Phase 3 を実行する:

1. **ソート**: `sort.field` + `sort.direction` で行をソート
2. **カーソルフィルタ**: `pagination.cursor` で範囲フィルタ（sort 後、slice 前に適用）
3. **ページネーション**: `offset` + `limit` でスライス
4. **テーブル分離**: rows を `posts` と `notifications` にグループ化
5. **Post Phase 2**: `buildPhase2Template()` で詳細 SELECT 実行 + Reblog 展開
6. **Post Phase 3**: `buildScopedBatchTemplates()` でバッチクエリ一括実行
7. **Notification Phase 2**: `NOTIFICATION_SELECT` + `NOTIFICATION_BASE_JOINS` で詳細取得
8. **displayOrder**: `(table, id)` ペアの配列で表示順序を保持

### flatFetchExecutor.ts — ID 収集＋詳細取得

`executeFlatFetch()` は FlowEditor からの確定済み ID リストを受け取り、最小限のクエリで表示データを取得する。

```
1. Core post fetch (id IN postIds)
2. Reblog parent expansion (reblog_of_post_id → 親投稿取得)
3. Core notification fetch (id IN notificationIds)
4. Notification related post expansion (related_post_id → 追加投稿)
5. Batch queries ×8 (全 postIds)
6. Profile emoji batch (通知アクター分)
7. Assemble → SqliteStoredStatus / SqliteStoredNotification
```

### WorkerNodeCache — テーブルバージョンベースキャッシュ

> ソースファイル: `src/util/db/query-ir/executor/workerNodeCache.ts`

Worker スレッド内で動作するキャッシュ。

- **キャッシュキー**: `nodeId + sql + binds + upstreamHash`
- **無効化**: テーブルバージョンの変更を `bumpVersion()` で検知し、依存テーブルのバージョンが変わったエントリを自動無効化
- **バージョン同期**: `syncVersions()` で外部（メインスレッド）のバージョンマップと同期

---

## カーソルプッシュダウン最適化

> ソースファイル: `src/util/db/query-ir/patchPlanForFetch.ts`

### cursor push-down の概念

スクロールバックやストリーミング差分取得の際、Output ノードのカーソルフィルタだけでは Phase 1 で全件を取得してからフィルタすることになる。cursor push-down は、**カーソル条件を get-ids ノードの WHERE 句に直接注入**することで、SQL レベルで対象範囲のみ取得する最適化。

### patchPlanForFetch

```typescript
function patchPlanForFetch(
  plan: QueryPlanV2,
  limit: number,
  cursor?: PaginationCursor,
): QueryPlanV2
```

パッチ対象:
1. **output-v2**: `pagination.cursor` と `pagination.limit` を設定
2. **get-ids**: `cursor` フィールドに `{column, op, value}` を注入
3. **merge-v2**: `limit` が不足していれば引き上げ

カーソルフィールドの変換:
- `cursor.field === 'id'` → `node.outputIdColumn ?? 'id'`
- `cursor.field === 'created_at_ms'` → `node.outputTimeColumn ?? getDefaultTimeColumn(table)`

### patchPlanForStreamingFetch

ストリーミング差分取得専用のバリアント。`changedTables` に含まれるテーブルのノードにのみカーソルを push-down し、変更のないテーブルのノードはキャッシュキーを変えないためカーソルを追加しない。

時刻カラムがないテーブル（`outputTimeColumn === null`）では ID ベースのカーソルにフォールバックする。

---

## FlowEditor との連携

> ソースファイル: `src/app/_components/FlowEditor/`

FlowEditor は QueryPlanV2 をビジュアルに編集するための DAG エディタ UI。

### ディレクトリ概要

```
src/app/_components/FlowEditor/
├── FlowQueryEditorModal.tsx    # モーダルラッパー
├── FlowCanvas.tsx              # React Flow キャンバス
├── flowToQueryPlanV2.ts        # FlowGraphState → QueryPlanV2
├── queryPlanToFlow.ts          # QueryPlanV2 → FlowGraphState
├── flowPresets.ts              # プリセットフロー定義
├── planHelpers.ts              # プランユーティリティ
├── inferFlowSourceType.ts      # ソースタイプ推定
├── addMenuItems.tsx            # ノード追加メニュー
├── nodes/                      # カスタム React Flow ノード
│   ├── GetIdsFlowNode.tsx
│   ├── LookupRelatedFlowNode.tsx
│   ├── MergeFlowNodeV2.tsx
│   ├── OutputFlowNodeV2.tsx
│   └── NodeExecBadge.tsx       # 実行統計バッジ
├── GetIdsPanel.tsx             # get-ids 設定パネル
├── LookupRelatedPanel.tsx      # lookup-related 設定パネル
├── MergePanelV2.tsx            # merge-v2 設定パネル
├── OutputPanelV2.tsx           # output-v2 設定パネル
├── FilterConditionRow.tsx      # フィルタ条件行
├── ExistsConditionRow.tsx      # EXISTS 条件行
├── DebugResultPanel.tsx        # 実行結果デバッグ表示
└── types.ts                    # FlowNode / FlowEdge 型定義
```

### 双方向変換

| 関数 | ソースファイル | 方向 |
|------|-------------|------|
| `flowToQueryPlanV2()` | `flowToQueryPlanV2.ts` | FlowGraphState → QueryPlanV2 |
| `queryPlanToFlow()` | `queryPlanToFlow.ts` | QueryPlan/QueryPlanV2 → FlowGraphState |

`queryPlanToFlow()` は V1 プランも受け付け、内部で `migrateQueryPlanV1ToV2()` を呼んで V2 に変換してから FlowGraphState に変換する。

FlowGraphState のレイアウトは Output ノードからの深さ（BFS）で自動計算される。各ノードの `data.config` に `QueryNodeV2` の実体が格納されており、`flowToQueryPlanV2()` で直接 `QueryPlanV2` に変換可能。

---

## 次に読むべきドキュメント

- **`05-streaming.md`** — WebSocket ストリーミングシステム。Query IR で生成したプランがストリーミング差分取得でどのように再利用されるか（`patchPlanForStreamingFetch` の実用例）。
