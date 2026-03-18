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

  // 設定に基づいて適切な結果を選択して返す
  if (config.advancedQuery) return customResult
  if (config.type === 'tag') return tagResult
  if (config.type === 'notification') return notificationResult
  return filteredResult
}
```

**設計判断**: React の Hook ルール（条件分岐内で Hook を呼んではならない）を遵守するため、すべての Hook を呼び出してから結果を選択する。使用されない Hook は内部で early return するため実質的なコストは低い。

## useFilteredTimeline

home / local / public タイムラインのメインクエリ Hook。

### 処理フロー

```
1. config から SQL フィルタ条件を生成（buildFilterConditions）
2. Phase 1: post_id リストを取得
3. Phase 2: 完全なデータを取得
4. rowToStoredStatus() で型変換
5. state に格納
6. subscribe('posts', requery) でリアクティブ更新
```

### データベース変更の購読

```typescript
useEffect(() => {
  const unsubscribe = subscribe('posts', () => {
    // posts テーブルに変更があった場合、再クエリ
    runQuery()
  })
  return unsubscribe
}, [])
```

ストリーミングやユーザー操作で `posts` テーブルが更新されると、`notifyChange('posts')` が呼ばれ、この購読コールバックが発火して再クエリが実行される。

### 設定変更による再クエリ

```typescript
useEffect(() => {
  runQuery()
}, [config, refreshToken])
```

`TimelineEditPanel` で設定が変更されると `config` が更新され、再クエリが実行される。`refreshToken` は `timelineRefresh.ts` の `notifyRefresh()` で強制リフレッシュする場合に使用。

## useFilteredTagTimeline

タグタイムライン専用の Hook。`useFilteredTimeline` と同じ 2 フェーズクエリだが、タグ固有の処理が追加される。

### OR / AND モードのクエリ差異

```typescript
if (config.tagConfig?.mode === 'and') {
  // HAVING COUNT(DISTINCT tag) = tags.length
  sql += `GROUP BY p.post_id HAVING COUNT(DISTINCT pbt.tag) = ?`
} else {
  // OR: IN + DISTINCT
  sql = `SELECT DISTINCT p.post_id ... WHERE pbt.tag IN (?, ?, ...)`
}
```

### タグごとの設定

`tagConfig` は各タグに対する追加設定を保持できる。

## useCustomQueryTimeline

Advanced Query モードの Hook。ユーザーが記述した SQL WHERE 句を実行する。

### 処理フロー

```
1. カスタムSQL をサニタイズ
2. テーブルエイリアス参照を解析してクエリ種別を判定
3. 種別に応じた実行:
   - status-only: 2フェーズクエリ
   - notification-only: 1フェーズクエリ
   - mixed: 投稿と通知を別々にクエリしてマージ
4. バージョンカウンタで競合を防止
```

### テーブルエイリアスの参照検出

```typescript
const aliases = detectReferencedAliases(query)
// {
//   p: true,    // posts
//   ptt: false, // timeline_items
//   pbt: true,  // posts_belonging_tags
//   pme: false, // posts_mentions
//   n: true,    // notifications
//   ...
// }
```

参照されたテーブルに応じて適切な JOIN を組み立てる。不要な JOIN を省略してクエリを最適化。

### Mixed Query のマージ

```typescript
// 投稿と通知を created_at_ms でインターリーブ
const merged = []
let si = 0, ni = 0
while (si < statuses.length && ni < notifications.length) {
  if (statuses[si].created_at_ms >= notifications[ni].created_at_ms) {
    merged.push({ ...statuses[si++], _type: 'status' })
  } else {
    merged.push({ ...notifications[ni++], _type: 'notification' })
  }
}
// 残りを追加
```

## useNotifications

通知タイムライン専用の Hook。

### クエリ構造

通知クエリは 1 フェーズ（2 フェーズではない）。通知データは投稿ほど複雑な JOIN を必要としない。

```sql
SELECT
  n.notification_id, n.created_at_ms, n.is_read,
  nt.code AS notification_type,
  pr.acct AS actor_acct, pr.display_name, pr.avatar_url,
  -- 関連投稿（あれば）
  p.post_id, p.content_html, ...
FROM notifications n
LEFT JOIN notification_types nt ON ...
LEFT JOIN profiles pr ON ...
LEFT JOIN posts p ON p.post_id = n.related_post_id
WHERE ...
ORDER BY n.created_at_ms DESC
```

### 通知フィルタ

```typescript
if (config.notificationFilter?.length) {
  conditions.push(`nt.code IN (${config.notificationFilter.map(() => '?').join(',')})`)
  binds.push(...config.notificationFilter)
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

### 仕組み

```typescript
const listeners = new Map<string, Set<() => void>>()

function notifyRefresh(timelineId: string) {
  listeners.get(timelineId)?.forEach(fn => fn())
}

function useConfigRefresh(timelineId: string) {
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    const handler = () => setRefreshToken(t => t + 1)
    // listeners に登録
    return () => { /* listeners から除去 */ }
  }, [timelineId])

  return refreshToken
}
```

`refreshToken` が変化すると Hook の依存配列が変わり再クエリが走る。

## HomeTimelineProvider（後方互換）

既存の UI コンポーネントが `HomeTimelineContext` / `NotificationsContext` を使って投稿・通知にアクセスしていた旧 API との互換レイヤー。

```typescript
// 内部で useFilteredTimeline / useNotifications を呼び出し
// 結果を旧 API のコンテキスト形状に変換

// アダプタ関数
const setReblogged = (appIndex, id, value) => {
  const backendUrl = apps[appIndex].backendUrl
  updateStatusAction(backendUrl, id, 'reblog', value)
}
```

`appIndex`（配列インデックス）を `backendUrl` に変換するアダプタとして機能する。
