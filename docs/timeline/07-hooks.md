# 07. React Hooks

## ディスパッチャー: useTimelineData

`useTimelineData.ts` はタイムライン設定に基づいて適切な Hook に処理を振り分けるファサード。

```typescript
function useTimelineData(config: TimelineConfigV2) {
  // React の Hook ルールにより、すべての Hook を無条件で呼び出す
  const filteredResult = useFilteredTimeline(config)
  const tagResult = useFilteredTagTimeline(config)
  const customResult = useCustomQueryTimeline(config)
  const notificationResult = useNotifications(config)

  // customQuery が設定されている場合は最優先で使用
  if (config.customQuery?.trim()) return customResult

  // type に基づいて適切な結果を選択して返す
  switch (config.type) {
    case 'home':
    case 'local':
    case 'public':
      return filteredResult
    case 'notification':
      return notificationResult
    case 'tag':
      return tagResult
    default:
      return { data: [], loadMore: noopLoadMore, queryDuration: null }
  }
}
```

**設計判断**: React の Hook ルール（条件分岐内で Hook を呼んではならない）を遵守するため、すべての Hook を呼び出してから結果を選択する。各 Hook は `config.type` 不一致時や `customQuery?.trim()` 設定時に早期リターンするため実質的なコストは低い。

**ディスパッチ優先順位**:
1. `customQuery` が非空 → `useCustomQueryTimeline`（Advanced Query モード）
2. `type === 'tag'` → `useFilteredTagTimeline`
3. `type === 'notification'` → `useNotifications`
4. `type === 'home' | 'local' | 'public'` → `useFilteredTimeline`

## 共通の戻り値型

すべての Hook が統一された戻り値を返す。

```typescript
{
  data: (StatusAddAppIndex | NotificationAddAppIndex)[]
  queryDuration: number | null   // 直近クエリの実行時間（ms）
  loadMore: () => void           // LIMIT 拡張関数
}
```

## useFilteredTimeline

home / local / public タイムラインのメインクエリ Hook。

### 処理フロー

```
1. `normalizeBackendFilter` + `resolveBackendUrls` で対象バックエンド URL を解決
2. `buildFilterConditions()` で SQL フィルタ条件を生成（useMemo で安定化）
3. Phase 1 SQL を構築（timeline_entries + posts + local_accounts JOIN）
4. `handle.fetchTimeline()` で Phase 1 → Phase 2 → バッチクエリ×7 を Worker 内で一括実行
5. `assembleStatusFromBatch()` + `buildBatchMapsFromResults()` で型変換
6. `fetchVersionRef` で古いクエリ結果を破棄
7. state に格納
```

### ChangeHint による選択的再クエリ

```typescript
const handleChange = useCallback((hints: ChangeHint[]) => {
  // ヒントが空 = ヒントなし通知（ユーザー操作等）→ 常に再取得
  if (hints.length === 0) { fetchData(); return }

  // ヒントがある場合: 自パネルに関係する変更かチェック
  const isRelevant = hints.some(hint => {
    if (hint.timelineType) {
      const types = configTimelineTypes ?? [configType]
      if (!types.includes(hint.timelineType)) return false
    }
    if (hint.backendUrl && !targetBackendUrls.includes(hint.backendUrl))
      return false
    return true
  })
  if (isRelevant) fetchData()
}, [fetchData, configType, configTimelineTypes, targetBackendUrls])

useEffect(() => {
  fetchData()
  return subscribe('posts', handleChange)
}, [fetchData, handleChange])
```

### 設定変更による再クエリ

`refreshToken`（`useConfigRefresh` から取得）が `fetchData` の依存配列に含まれるため、`TimelineEditPanel` で設定保存時に `notifyRefresh(timelineId)` が呼ばれると再クエリが実行される。

### loadMore

```typescript
const loadMore = useCallback(() => {
  setQueryLimit(prev => prev + TIMELINE_QUERY_LIMIT)
}, [])
```

`queryLimit` が変化すると `fetchData` の依存配列が変わり、Phase 1 の LIMIT が拡張された再クエリが走る。config 変更時には `queryLimit` を初期値にリセット。

## useFilteredTagTimeline

タグタイムライン専用の Hook。`useFilteredTimeline` と同じ fetchTimeline バッチ API を使用するが、タグ固有の処理が追加される。

### OR / AND モードのクエリ差異

```sql
-- OR モード:
  INNER JOIN post_hashtags pht ON p.id = pht.post_id
  INNER JOIN hashtags ht ON pht.hashtag_id = ht.id
  WHERE ht.name IN ('tag1', 'tag2')
  GROUP BY p.id
  ORDER BY p.created_at_ms DESC

-- AND モード:
  WHERE ht.name IN ('tag1', 'tag2')
  GROUP BY p.id
  HAVING COUNT(DISTINCT ht.name) = 2
  ORDER BY p.created_at_ms DESC
```

### ChangeHint によるフィルタ

タグ Hook は `hint.tag` も検査し、自パネルの対象タグに関係する変更のみで再クエリする。

## useCustomQueryTimeline

Advanced Query モードの Hook。ユーザーが記述した SQL WHERE 句を実行する。

### 処理フロー

```
1. カスタム SQL をサニタイズ（DML/DDL/PRAGMA 禁止、コメント拒否、? 禁止、v2 アップグレード）
2. `detectReferencedAliases()` でテーブルエイリアス参照を解析
3. クエリ種別を判定（status-only / notification-only / mixed）
4. 種別に応じた実行:
   - status-only: fetchTimeline バッチ API で 2 フェーズクエリ
   - notification-only: 1 フェーズクエリ
   - mixed: Notification Phase 1 → 時間下限導出 → Status Phase 1 → マージソート → Phase 2
5. 施策 A〜E の最適化適用
6. バージョンカウンタで競合を防止
```

### デバウンスされた subscribe

useCustomQueryTimeline は connection.ts の 80ms デバウンスに加え、Hook レベルで **500ms デバウンス** を追加。

```typescript
const debouncedFetch = (hints: ChangeHint[]) => {
  if (timer != null) clearTimeout(timer)
  timer = setTimeout(() => fetchData(), 500)
}

// クエリモードに応じて監視テーブルを選択
const unsubStatuses = queryMode !== 'notification'
  ? subscribe('posts', debouncedFetch) : undefined
const unsubNotifications = queryMode !== 'status'
  ? subscribe('notifications', debouncedFetch) : undefined
```

ストリーミングバーストによるカスタムクエリの重複実行を抑制する。

### Mixed Query のマージ

Phase 1 結果を created_at_ms でソートし上位 queryLimit 件を選定してから Phase 2 を実行。

```typescript
const merged = [...statusIds, ...notifIds]
  .sort((a, b) => b.created_at_ms - a.created_at_ms)
  .slice(0, queryLimit)
```

## useNotifications

通知タイムライン専用の Hook。

### クエリ構造

通知クエリは 1 フェーズ。`NOTIFICATION_SELECT` + `NOTIFICATION_BASE_JOINS` で必要なデータを一括取得。

```sql
SELECT {NOTIFICATION_SELECT}
FROM notifications n
  LEFT JOIN local_accounts la ON n.local_account_id = la.id
  LEFT JOIN notification_types nt ON n.notification_type_id = nt.id
  LEFT JOIN profiles ap ON n.actor_profile_id = ap.id
  LEFT JOIN posts rp ON n.related_post_id = rp.id
  LEFT JOIN profiles rppr ON rp.author_profile_id = rppr.id
  LEFT JOIN post_stats rpps ON rp.id = rpps.post_id
WHERE la.backend_url IN (?, ?)
  AND nt.name IN ('mention', 'favourite')
ORDER BY n.created_at_ms DESC
LIMIT ?
```

### 欠損 Status の自動補完

通知に関連する Status がDBに存在しない場合、API から個別に再取得して SQLite に追加。

```typescript
const missing = notifications.filter(n =>
  n.status === undefined &&
  TYPES_WITH_STATUS.has(n.type) &&
  !fetchedIdsRef.current.has(key)
)
// → getNotification(n.id) で再取得 → addNotification() で DB に保存
```

## リフレッシュシステム

`timelineRefresh.ts` が pub-sub パターンでリフレッシュ通知を管理する。

```typescript
// リスナー登録（Hook 側）
const refreshToken = useConfigRefresh(timelineId)

// リフレッシュ通知（設定変更時）
notifyRefresh(timelineId)
```

`refreshToken` が変化すると Hook の `fetchData` が再実行される。`TimelineManagement` の `onUpdate` が設定変更後に `notifyRefresh(id)` を呼び出す。

## HomeTimelineProvider（後方互換）

既存の UI コンポーネントが `HomeTimelineContext` / `NotificationsContext` を使って投稿・通知にアクセスしていた旧 API との互換レイヤー。

```typescript
// 内部で useFilteredTimeline / useNotifications を呼び出し
// 結果を旧 API のコンテキスト形状に変換

// StatusStoreActionsContext 経由のアクション
const setFavourited = (backendUrl, statusId, value) => {
  updateStatusAction(backendUrl, statusId, 'favourite', value)
}
```

`appIndex`（配列インデックス）ベースの旧 API を `backendUrl` ベースの新 API にブリッジする。
