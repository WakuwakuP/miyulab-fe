# データ取得ライフサイクル

タイムラインのデータ取得は **初期取得（Initial Fetch）**、**Streaming取得**、**スクロールバック（遡り取得）** の3つのフェーズで構成される。本ドキュメントでは各フェーズの仕組みと差異、Reducer による状態管理、排他制御、UI 統合までを実装に基づいて解説する。

---

## 目次

1. [概要 — データ取得の3フェーズ](#1-概要--データ取得の3フェーズ)
2. [Reducer状態マシン](#2-reducer状態マシン)
3. [初期取得（Initial Fetch）](#3-初期取得initial-fetch)
4. [Streaming取得](#4-streaming取得)
5. [スクロールバック（遡り取得）](#5-スクロールバック遡り取得)
6. [APIフォールバックとExhaustion](#6-apiフォールバックとexhaustion)
7. [カーソルとクエリパッチング](#7-カーソルとクエリパッチング)
8. [StreamingとスクロールバックのExclusive制御](#8-streamingとスクロールバックの排他制御)
9. [UI統合](#9-ui統合)
10. [完全なライフサイクル例](#10-完全なライフサイクル例)
11. [対比表（まとめ）](#11-対比表まとめ)

---

## 1. 概要 — データ取得の3フェーズ

```
                       ┌─────────────────────────────────────────────┐
                       │          miyulab-fe データ取得全体像          │
                       └─────────────────────────────────────────────┘

  ┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
  │  初期取得     │     │  Streaming取得    │     │  スクロールバック  │
  │ (Initial)    │────▶│  (Streaming)      │◀───▶│  (Scrollback)    │
  │              │     │                   │     │                  │
  │ アプリ起動時  │     │ WebSocket経由の    │     │ 下スクロール時の  │
  │ の初回ロード  │     │ リアルタイム更新   │     │  過去データ取得   │
  └──────────────┘     └──────────────────┘     └──────────────────┘
```

### 3フェーズ対比表（概要）

| 項目 | 初期取得 | Streaming取得 | スクロールバック |
|------|----------|--------------|-----------------|
| **トリガー** | コンポーネントマウント時（`useEffect`） | DB 変更通知（`ChangeHint`） | ユーザーの下スクロール（`endReached`） |
| **データソース** | SQLite（Query IR 実行） | SQLite（カーソル付き差分クエリ） | SQLite → 不足時 API フォールバック |
| **カーソル方向** | なし（フルページ取得） | `after`（newestMs 以降） | `before`（oldestMs 以前） |
| **API 使用** | なし（DB のみ） | なし（DB のみ） | DB 不足時のみ API 呼び出し |
| **状態遷移** | `未初期化 → initialized` | `initialized → 差分マージ` | `initialized → isScrollbackRunning → 完了` |

---

## 2. Reducer状態マシン

> ソースファイル: `src/util/hooks/timelineList/reducer.ts`

### TimelineListState の主要フィールド

```typescript
type TimelineListState = {
  // ---- データ ----
  sortedItems: TimelineItem[]       // ソート済みアイテム配列（降順）
  itemMap: Map<string, TimelineItem> // 一意キー → アイテム Map（dedup用）

  // ---- カーソル ----
  newestMs: number       // Streaming 差分取得用（最新アイテムの created_at_ms）
  newestId: number       // ID ベースカーソルフォールバック用
  oldestMs: number       // スクロールバック用（最古アイテムの created_at_ms）

  // ---- 状態フラグ ----
  initialized: boolean           // 初期化完了済みか
  isScrollbackRunning: boolean   // スクロールバック実行中か
  hasMoreOlder: boolean          // 過去方向にまだ取得可能か
  deferredStreaming: boolean     // scrollback 中にストリーミング通知が保留されたか

  // ---- Exhaustion ----
  exhaustedResources: Map<string, { notifications: boolean; statuses: boolean }>
}
```

### 全イベント型の分類

```typescript
type TimelineListEvent =
  // ---- 初期取得 ----
  | { items: TimelineItem[]; type: 'INITIAL_FETCH_SUCCEEDED' }
  | { type: 'INITIAL_FETCH_EMPTY' }

  // ---- Streaming ----
  | { items: TimelineItem[]; type: 'STREAMING_FETCH_SUCCEEDED' }
  | { type: 'STREAMING_DEFERRED' }
  | { items: TimelineItem[]; type: 'DEFERRED_STREAMING_FLUSH_SUCCEEDED' }

  // ---- スクロールバック ----
  | { type: 'SCROLLBACK_STARTED' }
  | { items: TimelineItem[]; type: 'SCROLLBACK_DB_SUCCEEDED' }
  | { hasMoreOlder: boolean; type: 'SCROLLBACK_COMPLETED' }

  // ---- 共通 ----
  | { type: 'HINTLESS_INVALIDATED' }
  | { items: TimelineItem[]; type: 'HINTLESS_REFETCH_SUCCEEDED' }
  | { type: 'RESET' }
```

#### フェーズごとのイベントマッピング

| フェーズ | イベント | 説明 |
|---------|---------|------|
| **初期取得** | `INITIAL_FETCH_SUCCEEDED` | データあり → `mergeItems` + `initialized = true` |
| **初期取得** | `INITIAL_FETCH_EMPTY` | データなし → `hasMoreOlder = false` + `initialized = true` |
| **Streaming** | `STREAMING_FETCH_SUCCEEDED` | 差分データ → `mergeItems` |
| **Streaming** | `STREAMING_DEFERRED` | scrollback 中 → `deferredStreaming = true` |
| **Streaming** | `DEFERRED_STREAMING_FLUSH_SUCCEEDED` | 保留分フラッシュ → `mergeItems` + `deferredStreaming = false` |
| **スクロールバック** | `SCROLLBACK_STARTED` | 開始 → `isScrollbackRunning = true` |
| **スクロールバック** | `SCROLLBACK_DB_SUCCEEDED` | DB 結果 → `mergeItems` |
| **スクロールバック** | `SCROLLBACK_COMPLETED` | 完了 → `isScrollbackRunning = false` + `hasMoreOlder` 更新 |
| **共通** | `HINTLESS_INVALIDATED` | Mute/Block 変更 → 状態リセット（`initialized` 保持） |
| **共通** | `HINTLESS_REFETCH_SUCCEEDED` | リセット後再取得 → `mergeItems` + `initialized = true` |
| **共通** | `RESET` | 設定変更 → 完全初期化 |

### mergeItems ヘルパーの動作

```
mergeItems(state, newItems)
  │
  ├── newItems が空 → state をそのまま返す
  │
  ├── itemMap を shallow clone
  │
  ├── 各 item について:
  │   ├── itemKey(item) で一意キーを生成（"p:{post_id}" or "n:{notification_id}"）
  │   ├── nextMap.set(key, item) → 既存アイテムは上書き（デデュプ）
  │   ├── timestamp が newestMs より大 → newestMs 更新
  │   ├── timestamp が oldestMs より小 → oldestMs 更新
  │   └── numericId が newestId より大 → newestId 更新
  │
  └── sortItemsDesc() で降順ソート → sortedItems 再生成
```

**ポイント**: Map ベースのデデュプにより、同一アイテムの重複追加が安全に処理される。Streaming とスクロールバックで取得範囲が重複しても、`itemKey` による一意性が保証される。

### 状態遷移図

```
                          RESET
                            │
                            ▼
              ┌──────────────────────┐
              │     未初期化          │
              │  initialized: false  │
              │  hasMoreOlder: true  │
              └──────────┬───────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
   INITIAL_FETCH   INITIAL_FETCH   HINTLESS_
     _EMPTY         _SUCCEEDED    INVALIDATED
          │              │              │
          ▼              ▼              ▼
   ┌────────────┐ ┌────────────┐ ┌────────────┐
   │ 初期化済み  │ │ 初期化済み  │ │ リセット中  │
   │ データなし  │ │ データあり  │ │ (再取得待ち)│
   │ hasMore:   │ │ hasMore:   │ └─────┬──────┘
   │   false    │ │   true     │       │
   └────────────┘ └─────┬──────┘ HINTLESS_REFETCH
                        │        _SUCCEEDED
                        │              │
              ┌─────────┼──────────────┘
              │         │
              ▼         ▼
       ┌─────────────────────┐
       │    アイドル状態       │
       │  initialized: true  │
       │  Streaming 受信待ち  │
       └───┬─────────────┬───┘
           │             │
  STREAMING_FETCH    SCROLLBACK
   _SUCCEEDED        _STARTED
           │             │
           ▼             ▼
    ┌────────────┐ ┌─────────────────┐
    │ 差分マージ  │ │ スクロールバック  │
    │ (即座に     │ │   実行中         │
    │  アイドルへ)│ │ isScrollback-   │
    └────────────┘ │  Running: true   │
                   └────────┬────────┘
                            │
                   SCROLLBACK_COMPLETED
                            │
                            ▼
                   ┌────────────────┐
                   │ 完了            │
                   │ deferredあり →  │
                   │  FLUSH 実行    │
                   └────────────────┘
```

---

## 3. 初期取得（Initial Fetch）

> ソースファイル: `src/util/hooks/useTimelineList.ts`

### フロー

```
useTimelineList マウント
  │
  ├── stateRef.current.initialized === true → スキップ
  ├── options?.disabled === true → スキップ
  │
  └── fetchPage({ limit: PAGE_SIZE })  ← カーソルなし = フルページ取得
       │
       ├── result.items.length === 0
       │   └── dispatch({ type: 'INITIAL_FETCH_EMPTY' })
       │       → initialized = true, hasMoreOlder = false
       │
       └── result.items.length > 0
           ├── dispatch({ items, type: 'INITIAL_FETCH_SUCCEEDED' })
           │   → initialized = true, mergeItems 実行
           │
           └── items.length < PAGE_SIZE の場合
               └── dispatch({ hasMoreOlder: false, type: 'SCROLLBACK_COMPLETED' })
                   → 即座に exhaustion（DBに PAGE_SIZE 未満しかデータがない）
```

### コード（`useTimelineList.ts` L96-L112）

```typescript
useEffect(() => {
  if (stateRef.current.initialized) return
  if (options?.disabled) return

  fetchPage({ limit: PAGE_SIZE }).then((result) => {
    if (!result) return
    recordDuration(result.durationMs)
    if (result.items.length === 0) {
      dispatch({ type: 'INITIAL_FETCH_EMPTY' })
    } else {
      dispatch({ items: result.items, type: 'INITIAL_FETCH_SUCCEEDED' })
      if (result.items.length < PAGE_SIZE) {
        dispatch({ hasMoreOlder: false, type: 'SCROLLBACK_COMPLETED' })
      }
    }
  })
}, [fetchPage, recordDuration, options?.disabled])
```

### 重要なポイント

- **カーソルなし**: 初期取得では `fetchPage` にカーソルを渡さない。`basePlan` がそのまま実行される
- **PAGE_SIZE**: `TIMELINE_QUERY_LIMIT`（デフォルト 50）で定義
- **即座 exhaustion**: 取得件数が `PAGE_SIZE` 未満の場合、DB にこれ以上古いデータがないと判断し、`hasMoreOlder = false` に設定

---

## 4. Streaming取得

> ソースファイル: `src/util/hooks/timelineList/useTimelineStreamingController.ts`

### DB変更通知（ChangeHint）の購読メカニズム

Streaming 取得は WebSocket から直接データを受け取るのではなく、**DB 変更通知を起点とする間接的な仕組み**で動作する:

```
WebSocket (Streaming)
  │
  ├── 新しい投稿/通知を受信
  │
  └── SQLite に書き込み
       │
       └── ChangeHint を発行（テーブル名 + timelineType + backendUrl）
            │
            ├── subscribe() で登録されたコールバックが発火
            │
            ├── hintsMatchTimeline() でフィルタリング
            │   ├── timelineType がこのタイムラインに該当するか
            │   ├── backendUrl が対象バックエンドに含まれるか
            │   └── lookup テーブルの場合は timelineType チェックをスキップ
            │
            └── マッチした場合 → onMatched(changedTables) コールバック
```

### onMatched コールバックの処理フロー

```
onMatched(changedTables)
  │
  ├── isScrollbackRunning === true
  │   └── dispatch({ type: 'STREAMING_DEFERRED' })  ← 保留
  │
  ├── initialized === false
  │   └── スキップ（初期ロード完了前）
  │
  └── initialized === true かつ scrollback なし
       │
       ├── buildStreamingCursor(state) でカーソル構築
       │
       └── fetchPage({ changedTables, cursor, limit: PAGE_SIZE })
            │
            └── dispatch({ items, type: 'STREAMING_FETCH_SUCCEEDED' })
                → mergeItems で差分マージ
```

### buildStreamingCursor の動作

> ソースファイル: `src/util/hooks/timelineList/streamingHelpers.ts`

```typescript
function buildStreamingCursor(state): PaginationCursor | undefined {
  if (state.newestMs > 0) {
    return {
      direction: 'after',
      field: 'created_at_ms',
      value: state.newestMs - CURSOR_MARGIN_MS,  // 1ms の安全マージン
    }
  }
  if (state.newestId > 0) {
    return { direction: 'after', field: 'id', value: state.newestId }
  }
  return undefined  // カーソルなし = フルページ取得
}
```

- **方向**: `after`（現在の最新より新しいアイテムのみ取得）
- **安全マージン**: `CURSOR_MARGIN_MS = 1` により、同一ミリ秒に複数アイテムがある場合の取りこぼしを防止
- **フォールバック**: `newestMs` がない場合は `newestId` ベースのカーソルを使用

### changedTables によるセレクティブクエリ

`fetchPage` に `changedTables` を渡すことで、`patchPlanForStreamingFetch` が変更のあったテーブルのノードにのみカーソルを push-down する。これにより、**変更のないテーブルはキャッシュ済みの結果を再利用**できる。

### Hintless 変更（ミュート/ブロック）の特殊処理

```
onHintless()  ← hint が空の ChangeHint（mute/block 変更など）
  │
  ├── dispatch({ type: 'HINTLESS_INVALIDATED' })
  │   → 状態をほぼ完全にリセット（initialized のみ保持）
  │
  └── fetchPage({ limit: PAGE_SIZE })  ← カーソルなし再取得
       │
       ├── dispatch({ items, type: 'HINTLESS_REFETCH_SUCCEEDED' })
       │
       └── items.length < PAGE_SIZE の場合
           └── dispatch({ hasMoreOlder: false, type: 'SCROLLBACK_COMPLETED' })
```

Mute/Block の変更は特定のテーブルや timelineType に紐づかないため、タイムライン全体を再構築する必要がある。

---

## 5. スクロールバック（遡り取得）

> ソースファイル: `src/util/hooks/timelineList/useTimelineScrollbackController.ts`

### loadOlder() の全体フロー

```
loadOlder()
  │
  │ ── Step 1: ガードチェック ──
  │
  ├── isScrollbackRunning === true → return（二重実行防止）
  ├── hasMoreOlder === false → return（既に末端到達）
  │
  ├── dispatch({ type: 'SCROLLBACK_STARTED' })
  │   → isScrollbackRunning = true
  │
  │ ── Step 2: DB クエリ ──
  │
  ├── fetchPage({
  │     cursor: { direction: 'before', field: 'created_at_ms', value: oldestMs },
  │     limit: PAGE_SIZE
  │   })
  │
  │ ── Step 3: DB結果の判定 ──
  │
  ├── result.items.length >= PAGE_SIZE
  │   ├── dispatch({ items, type: 'SCROLLBACK_DB_SUCCEEDED' })
  │   └── return（DB だけで十分 → API 不要）
  │
  ├── result.items.length > 0 かつ < PAGE_SIZE
  │   └── dispatch({ items, type: 'SCROLLBACK_DB_SUCCEEDED' })
  │       （部分結果を先にマージ → カーソル更新）
  │
  │ ── Step 4: API フォールバック ──
  │
  ├── fetchOlderFromApi(config, apps, targetBackendUrls, exhaustedResources, ...)
  │   → 各バックエンドの最古 ID で API ページネーション → SQLite に書き込み
  │
  │ ── Step 5: リトライ DB クエリ ──
  │
  ├── fetchPage({
  │     cursor: { direction: 'before', field: 'created_at_ms', value: oldestMs },
  │     limit: PAGE_SIZE
  │   })
  │   （API が DB に書き込んだデータを取得）
  │
  ├── retry.items.length > 0
  │   └── dispatch({ items, type: 'SCROLLBACK_DB_SUCCEEDED' })
  │
  │ ── Step 6: Exhaustion チェック ──
  │
  ├── allExhausted かつ retry データなし
  │   └── dispatch({ hasMoreOlder: false, type: 'SCROLLBACK_COMPLETED' })
  │       → これ以上遡れない
  │
  │ ── Step 7: Deferred Streaming のフラッシュ（finally ブロック） ──
  │
  └── finally:
       ├── dispatch({ hasMoreOlder, type: 'SCROLLBACK_COMPLETED' })
       │   → isScrollbackRunning = false
       │
       └── deferredStreaming === true の場合
           ├── buildStreamingCursor(state) でカーソル構築
           └── fetchPage({ cursor, limit: PAGE_SIZE })
               └── dispatch({ items, type: 'DEFERRED_STREAMING_FLUSH_SUCCEEDED' })
```

### カーソルの方向

スクロールバックでは `direction: 'before'` を使用する:

```typescript
cursor: {
  direction: 'before',
  field: 'created_at_ms',
  value: stateRef.current.oldestMs,
}
```

これは SQL レベルで `created_at_ms < {oldestMs}` として展開され、現在表示中の最古アイテムより前のデータのみを取得する。

---

## 6. APIフォールバックとExhaustion

> ソースファイル: `src/util/timelineFetcher.ts`

### fetchOlderFromApi の処理フロー

```
fetchOlderFromApi(config, apps, targetBackendUrls, exhaustedResources, includeNotifications)
  │
  ├── fetchStatuses（config.type !== 'notification' の場合）
  │   └── fetchOlderStatusesFromApi()
  │       │
  │       ├── activeUrls = 未枯渇のバックエンド URL をフィルタ
  │       │
  │       └── 各 URL で並列実行:
  │           ├── getOldestStatusId(handle, config, url)
  │           │   → SQLite から最古の backend-local ID を取得
  │           │
  │           ├── oldestId がない場合
  │           │   └── fetchInitialData() で初期データ取得
  │           │
  │           └── oldestId がある場合
  │               ├── fetchMoreData(client, config, url, oldestId)
  │               │   → max_id パラメータで Mastodon API ページネーション
  │               │   → レスポンスを SQLite に bulkUpsert
  │               │
  │               └── count < FETCH_LIMIT (40)
  │                   → markExhausted(map, url, 'statuses')
  │
  └── fetchNotifications（notification タイムラインまたは mixed の場合）
      └── fetchOlderNotificationsFromApi()
          └── 同様のロジック（getOldestNotificationId → fetchMoreNotifications）
```

### getOldestStatusId の仕組み

SQLite 内の最古の `local_id`（バックエンド固有の投稿 ID）を取得する。この ID は Mastodon/Pleroma API の `max_id` パラメータとして使用される:

```sql
-- timeline_entries ベースのクエリ（home/local/public）
SELECT pb2.local_id
FROM posts p
INNER JOIN post_backend_ids pb2 ON pb2.post_id = p.id
INNER JOIN local_accounts la ON la.id = pb2.local_account_id
INNER JOIN timeline_entries te ON te.post_id = p.id AND te.local_account_id = la.id
WHERE la.backend_url = ? AND te.timeline_key = ?
ORDER BY p.created_at_ms ASC
LIMIT 1;
```

### ExhaustedResources の構造

```typescript
type ExhaustedResources = Map<
  string,  // backendUrl
  { notifications: boolean; statuses: boolean }
>
```

- **Per-backend 管理**: マルチアカウント環境では各バックエンドが独立したデータソースであるため、枯渇状態はバックエンド単位で追跡する
- `statuses: true` → そのバックエンドの投稿 API は末端に到達
- `notifications: true` → そのバックエンドの通知 API は末端に到達

### allExhausted の判定ロジック

```typescript
// スクロールバックコントローラ内（useTimelineScrollbackController.ts L112-L131）
const fetchNotifs = config.type === 'notification' || includeNotifications
const statusesExhausted =
  config.type === 'notification' ||
  allExhaustedFor(exhaustedResources, targetBackendUrls, 'statuses')
const notifsExhausted =
  !fetchNotifs ||
  allExhaustedFor(exhaustedResources, targetBackendUrls, 'notifications')
const allExhausted = statusesExhausted && notifsExhausted
```

`allExhaustedFor` は **全対象バックエンドURL** が指定リソースに対して枯渇しているかを判定する:

```typescript
function allExhaustedFor(map, targetBackendUrls, resource): boolean {
  return targetBackendUrls.every((url) => getExhausted(map, url)[resource])
}
```

### FETCH_LIMIT による exhaustion マーキング

API レスポンスの件数が `FETCH_LIMIT`（40件）未満の場合、そのバックエンドのリソースは枯渇したとマークされる。これは Mastodon API の慣例に基づく（要求 limit 未満のレスポンス = これ以上古いデータがない）。

---

## 7. カーソルとクエリパッチング

> ソースファイル: `src/util/db/query-ir/patchPlanForFetch.ts`, `src/util/db/query-ir/nodes.ts`

### PaginationCursor 型

```typescript
type PaginationCursor = {
  field: 'created_at_ms' | 'id'  // カーソル比較フィールド
  value: number                   // カーソル値（ミリ秒 or 内部 ID）
  direction: 'before' | 'after'  // before: より古い行, after: より新しい行
}
```

### patchPlanForFetch — スクロールバック用

全ノードに対してカーソルを注入する。**初期取得とスクロールバック**で使用される:

```
patchPlanForFetch(plan, limit, cursor?)
  │
  ├── output-v2 ノード
  │   └── pagination に cursor と limit を設定
  │
  ├── merge-v2 ノード
  │   └── limit を引き上げ（Math.max(既存limit, 新limit)）
  │
  └── get-ids ノード（cursor がある場合のみ）
      └── cursor.column / cursor.op / cursor.value を注入
          → SQL の WHERE 句に展開される
```

### patchPlanForStreamingFetch — Streaming用

**変更テーブルのみにカーソルを push-down** する最適化版:

```
patchPlanForStreamingFetch(plan, limit, cursor, changedTables)
  │
  ├── output-v2 ノード
  │   └── 同上（全ノード共通）
  │
  ├── merge-v2 ノード
  │   └── 同上
  │
  └── get-ids ノード
      ├── changedTables.has(node.table) === false
      │   └── 変更なし → カーソル注入しない（キャッシュ再利用）
      │
      └── changedTables.has(node.table) === true
          └── カーソル注入
              ├── cursor.field === 'id' → outputIdColumn を使用
              ├── cursor.field === 'created_at_ms' かつ outputTimeColumn あり
              │   → outputTimeColumn を使用
              └── outputTimeColumn が null（時刻カラムなし）
                  → outputIdColumn にフォールバック
```

### get-ids ノードへの WHERE 句注入

カーソルが注入されると、get-ids ノードの SQL は以下のように変化する:

```sql
-- カーソルなし（初期取得）
SELECT id, created_at_ms FROM posts WHERE ...

-- スクロールバック（before カーソル）
SELECT id, created_at_ms FROM posts WHERE ... AND created_at_ms < {oldestMs}

-- Streaming（after カーソル）
SELECT id, created_at_ms FROM posts WHERE ... AND created_at_ms > {newestMs - 1}
```

### output-v2 ノードの pagination 設定

`output-v2` ノードには最終的なページネーション（limit + cursor）が設定される。これは SQL の最終 SELECT に `LIMIT` と `WHERE` 句として適用される。

---

## 8. StreamingとスクロールバックのExclusive制御

### 排他制御が必要な理由

Streaming とスクロールバックが同時に `itemMap` を更新すると、以下の問題が発生する:

1. **カーソルの不整合**: スクロールバック中に `newestMs` が更新されると、次の Streaming カーソルが不正確になる
2. **itemMap の整合性**: 同時書き込みで Map のキーが競合し、意図しない上書きが発生する可能性がある
3. **UI の不安定性**: スクロール位置計算（`firstItemIndex`）が予測不能になる

### 排他制御メカニズム

```
Streaming 通知到着
  │
  ├── isScrollbackRunning === true
  │   │
  │   └── dispatch({ type: 'STREAMING_DEFERRED' })
  │       → deferredStreaming = true
  │       → 実際のデータ取得は行わない
  │
  └── isScrollbackRunning === false
      └── 通常の Streaming 処理

スクロールバック完了（finally ブロック）
  │
  ├── dispatch({ type: 'SCROLLBACK_COMPLETED' })
  │   → isScrollbackRunning = false
  │
  └── deferredStreaming === true の場合
      │
      ├── buildStreamingCursor(state)
      │   → newestMs ベースの after カーソルを構築
      │
      └── fetchPage({ cursor, limit: PAGE_SIZE })
          │
          └── dispatch({ type: 'DEFERRED_STREAMING_FLUSH_SUCCEEDED' })
              → deferredStreaming = false
              → 保留分のデータをマージ
```

### シーケンス図

```
  Streaming         Reducer          Scrollback
     │                 │                 │
     │                 │  SCROLLBACK_    │
     │                 │◀─STARTED────────│
     │                 │  running=true   │
     │                 │                 │
     │  DB変更通知      │                 │ DB クエリ実行中
     │────────────────▶│                 │
     │  running=true   │                 │
     │  → DEFERRED     │                 │
     │                 │                 │
     │                 │  SCROLLBACK_    │
     │                 │◀─DB_SUCCEEDED──│
     │                 │  mergeItems     │
     │                 │                 │
     │                 │  SCROLLBACK_    │
     │                 │◀─COMPLETED─────│
     │                 │  running=false  │
     │                 │                 │
     │                 │  deferred=true  │
     │                 │  → FLUSH 実行   │
     │◀────────────────│                 │
     │  DEFERRED_      │                 │
     │  STREAMING_     │                 │
     │  FLUSH_         │                 │
     │  SUCCEEDED      │                 │
     │                 │                 │
```

---

## 9. UI統合

> ソースファイル: `src/app/_components/UnifiedTimeline.tsx`

### データ取得チェーン

```
UnifiedTimeline
  └── useTimelineData(config)
       └── useTimelineList(config)
            ├── useTimelineDataSource(config)  → fetchPage, subscribeToChanges
            ├── useTimelineStreamingController → Streaming 購読
            └── useTimelineScrollbackController → loadOlder コールバック
```

### react-virtuoso と loadOlder の接続

```typescript
<Virtuoso
  data={timeline}
  endReached={hasMoreOlder ? loadOlder : undefined}
  // hasMoreOlder が false なら endReached を無効化
  // → スクロール末端到達時の自動呼び出しを停止
  ...
/>
```

- `endReached`: Virtuoso がリスト末端付近に到達した時に呼ばれるコールバック
- `hasMoreOlder` が `false` の場合は `undefined` を渡して無効化

### hasMoreOlder / isLoadingOlder の UI 反映

```typescript
// Footer スピナー表示
const virtuosoComponents = useMemo(
  () => ({
    Footer: () =>
      isLoadingOlder ? (
        <div className="flex items-center justify-center py-4">
          <CgSpinner className="animate-spin text-gray-400" size={24} />
        </div>
      ) : null,
  }),
  [isLoadingOlder],
)
```

`isLoadingOlder`（= `state.isScrollbackRunning`）が `true` の間、リスト末尾にスピナーが表示される。

### firstItemIndex による仮想スクロール位置管理

```typescript
const CENTER_INDEX = Math.floor(Number.MAX_SAFE_INTEGER / 2)

const internalIndex = CENTER_INDEX - currentLength + bottomExpansionRef.current
```

Virtuoso の `firstItemIndex` は、先頭方向（新しいアイテムの prepend）と末尾方向（古いアイテムの append）の両方でリストが拡張される場合に、スクロール位置を安定させるための仮想インデックス。`CENTER_INDEX` を起点とすることで、双方向の拡張を安全にハンドリングする。

`bottomExpansionRef` は末尾に追加されたアイテム数を追跡し、`firstItemIndex` のオフセットを調整する。

---

## 10. 完全なライフサイクル例

ユーザーがタイムラインを下にスクロールしながら、同時にストリーミングで新しい投稿が到着するシナリオ:

```
時刻   操作                      Reducer イベント             状態変化
─────  ────────────────────────  ─────────────────────────  ──────────────────────

T0     アプリ起動                  —                          initialized: false
       │
T1     初期取得実行                INITIAL_FETCH_SUCCEEDED    initialized: true
       fetchPage({ limit: 50 })                              newestMs: 1700000050000
       → 50件取得                                             oldestMs: 1700000001000
       │                                                      sortedItems: [50件]
       │
T2     Streaming: 新投稿到着       STREAMING_FETCH_SUCCEEDED  newestMs: 1700000051000
       DB変更通知 → onMatched                                 sortedItems: [51件]
       fetchPage({ cursor:
         after 1700000049999 })
       → 1件差分取得
       │
T3     ユーザーが下スクロール       SCROLLBACK_STARTED         isScrollbackRunning: true
       endReached → loadOlder()
       │
T4     Streaming: 新投稿到着       STREAMING_DEFERRED         deferredStreaming: true
       DB変更通知 → onMatched                                 （データ取得は保留）
       running=true → 保留
       │
T5     DB クエリ完了               SCROLLBACK_DB_SUCCEEDED    sortedItems: [101件]
       50件取得（十分）                                        oldestMs: 1699999951000
       │
T6     スクロールバック完了         SCROLLBACK_COMPLETED       isScrollbackRunning: false
       finally ブロック実行
       │
T7     保留 Streaming フラッシュ    DEFERRED_STREAMING_        deferredStreaming: false
       buildStreamingCursor                                   sortedItems: [102件]
       → after 1700000050999      FLUSH_SUCCEEDED             newestMs: 1700000052000
       fetchPage で差分取得
       │
T8     アイドル状態                 —                          次の Streaming/
       Streaming 受信待ち                                     スクロールバック待ち
```

### DB不足 → APIフォールバックのシナリオ

```
時刻   操作                        状態変化
─────  ──────────────────────────  ──────────────────────────

T10    loadOlder() 実行             isScrollbackRunning: true

T11    DB クエリ: 10件のみ取得       SCROLLBACK_DB_SUCCEEDED
       （PAGE_SIZE=50 未満）         oldestMs 更新

T12    fetchOlderFromApi() 実行
       ├── getOldestStatusId()
       │   → "12345" (local_id)
       ├── API: GET /timelines/home?max_id=12345&limit=40
       │   → 40件取得 → SQLite に書き込み
       └── 40件 >= FETCH_LIMIT
           → statuses 枯渇なし

T13    リトライ DB クエリ             SCROLLBACK_DB_SUCCEEDED
       API 書き込み分を取得           oldestMs さらに更新

T14    SCROLLBACK_COMPLETED          isScrollbackRunning: false
                                     hasMoreOlder: true（まだ続きあり）

---（さらにスクロール）---

T20    loadOlder() 再実行

T21    DB: 5件, API: 30件 (< 40)     markExhausted('statuses')

T22    allExhausted かつ             hasMoreOlder: false
       リトライ 0件                   → UI: スピナー非表示
                                     → endReached 無効化
```

---

## 11. 対比表（まとめ）

| 項目 | 初期取得 | Streaming | スクロールバック |
|------|----------|-----------|----------------|
| **トリガー** | `useEffect`（マウント時、`initialized === false`） | DB 変更通知（`ChangeHint` + `subscribe`） | `endReached`（Virtuoso がリスト末端到達） |
| **カーソル方向** | なし（フルページ） | `after`（`newestMs - CURSOR_MARGIN_MS`） | `before`（`oldestMs`） |
| **データソース** | SQLite（Query IR） | SQLite（Query IR + カーソル） | SQLite → 不足時 Mastodon API → SQLite |
| **API 呼び出し** | なし | なし | DB 不足時のみ（`fetchOlderFromApi`） |
| **パッチ関数** | `patchPlanForFetch`（カーソルなし） | `patchPlanForStreamingFetch`（変更テーブルのみ） | `patchPlanForFetch`（全ノードにカーソル注入） |
| **Reducer イベント** | `INITIAL_FETCH_SUCCEEDED` / `INITIAL_FETCH_EMPTY` | `STREAMING_FETCH_SUCCEEDED` / `STREAMING_DEFERRED` | `SCROLLBACK_STARTED` / `SCROLLBACK_DB_SUCCEEDED` / `SCROLLBACK_COMPLETED` |
| **exhaustion 影響** | `items < PAGE_SIZE` で即座に `hasMoreOlder = false` | なし | API レスポンス < `FETCH_LIMIT` で per-backend exhaustion |
| **排他制御** | なし（初回のみ実行） | scrollback 中は `STREAMING_DEFERRED` で保留 | 完了後に deferred streaming をフラッシュ |
| **状態フラグ** | `initialized` | `deferredStreaming` | `isScrollbackRunning`, `hasMoreOlder` |

---

## 関連ドキュメント

- [Query IRシステム](./04-query-ir.md) — クエリコンパイルパイプライン、ノード定義、patchPlanForFetch の詳細
- [ストリーミング](./05-streaming.md) — WebSocket 管理、StreamRegistry、ChangeHint の発行元
- [コンポーネント設計](./07-component-architecture.md) — UnifiedTimeline、DynamicTimeline のコンポーネント構造
