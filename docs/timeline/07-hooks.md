# 07. React Hooks

## 統合ファサード: useTimelineData

`useTimelineData.ts` は `useGraphTimeline` への薄いラッパーで、タイムライン種別によらず統一的にデータを取得する。

```typescript
function useTimelineData(config: TimelineConfigV2) {
  return useGraphTimeline(config)
}
```

## useGraphTimeline — グラフ実行エンジン Hook

すべてのタイムラインデータ取得を担う統合 Hook。`QueryPlanV2` グラフを Worker 内で実行し、結果をリアクティブに返す。

### 処理フロー

```
1. config.queryPlan があればそのまま使用、なければ configToQueryPlanV2() で自動生成
2. resolveBackendUrls() で対象バックエンド URL → localAccountIds / serverIds を解決
3. Worker に execute-graph-plan コマンドを送信
   - Worker 内: DAG トポロジカルソートで実行順序を決定
   - 各ノード (GetIds → LookupRelated → Merge → Output) を順次実行
   - WorkerNodeCache でテーブルバージョンに基づくキャッシュ
   - Output ノード: Phase2/Phase3 バッチクエリで詳細データ取得
4. 結果を assembleStatusFromBatch / rowToStoredNotification で型変換
5. state に格納
```

### QueryPlanV2 の自動生成

`config.queryPlan` が未設定の場合、`configToQueryPlanV2()` が config.type に基づいてグラフを生成:

| config.type | 生成されるグラフ |
|---|---|
| home / local / public | GetIds(timeline_entries) → Output |
| tag | GetIds(posts, EXISTS post_hashtags) → Output |
| notification | GetIds(notifications) → Output |
| composite (複数 type) | 複数 GetIds → Merge(interleave-by-time) → Output |

### ChangeHint による選択的再クエリ

```typescript
const handleChange = useCallback((hints: ChangeHint[]) => {
  if (hints.length === 0) { fetchData(); return }
  const isRelevant = hints.some(hint => {
    if (hint.timelineType && !targetTypes.includes(hint.timelineType)) return false
    if (hint.backendUrl && !targetBackendUrls.includes(hint.backendUrl)) return false
    return true
  })
  if (isRelevant) fetchData()
}, [fetchData, targetTypes, targetBackendUrls])
```

### 通知の欠損 Status 自動補完

通知タイムラインで status が undefined の場合、API から個別に再取得:

```typescript
const missing = notifications.filter(n =>
  n.status === undefined &&
  TYPES_WITH_STATUS.has(n.type) &&
  !fetchedIdsRef.current.has(key)
)
// → getNotification(n.id) で再取得 → addNotification() で DB に保存
```

### loadMore

```typescript
const loadMore = useCallback(() => {
  setQueryLimit(prev => prev + TIMELINE_QUERY_LIMIT)
}, [])
```

`queryLimit` が変化すると Output ノードの pagination.limit が更新され再クエリが実行される。

## 共通の戻り値型

```typescript
{
  data: (StatusAddAppIndex | NotificationAddAppIndex)[]
  queryDuration: number | null   // 直近クエリの実行時間（ms）
  loadMore: () => void           // LIMIT 拡張関数
}
```

## リフレッシュシステム

`timelineRefresh.ts` が pub-sub パターンでリフレッシュ通知を管理する。

```typescript
// リスナー登録（Hook 側）
const refreshToken = useConfigRefresh(timelineId)

// リフレッシュ通知（設定変更時）
notifyRefresh(timelineId)
```

`refreshToken` が変化すると Hook の `fetchData` が再実行される。

## HomeTimelineProvider（後方互換）

既存 UI が `HomeTimelineContext` / `NotificationsContext` 経由でデータにアクセスする旧 API との互換レイヤー。内部で `useTimelineData` を使用。

```typescript
// home / notification 用の固定 config で useTimelineData を呼び出し
const { data: homeTimeline } = useTimelineData(homeConfig)
const { data: notifications } = useTimelineData(notifConfig)
```

`appIndex`（配列インデックス）ベースの旧 API を `backendUrl` ベースの新 API にブリッジする。
