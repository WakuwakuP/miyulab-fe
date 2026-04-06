'use client'

/**
 * useTimelineList — インメモリタイムラインリスト管理
 *
 * useTimelineDataSource のページ取得 API を使い、
 * インメモリ Map でアイテムを蓄積・dedup・ソートする。
 *
 * - 初期ロード: fetchPage(limit=50) → Map に格納
 * - ストリーミング: fetchPage(cursor={after: newestMs}) → 差分のみ Map に追加
 * - スクロールバック: fetchPage(cursor={before: oldestMs}) → Map に追加
 * - DB 枯渇時: API フォールバック → DB に保存 → DB change で再取得
 * - hintless 変更 (mute/block): Map 全クリア → 再初期化
 */

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type {
  NotificationAddAppIndex,
  StatusAddAppIndex,
  TimelineConfigV2,
} from 'types/types'
import { addNotification } from 'util/db/sqlite/notificationStore'
import { TIMELINE_QUERY_LIMIT } from 'util/environment'
import { GetClient } from 'util/GetClient'
import { useQueryDuration } from 'util/hooks/useQueryDuration'
import {
  type TimelineItem,
  type UseTimelineDataSourceOptions,
  useTimelineDataSource,
} from 'util/hooks/useTimelineDataSource'
import { AppsContext } from 'util/provider/AppsProvider'
import { fetchOlderFromApi } from 'util/timelineFetcher'

// --------------- 定数 ---------------

const PAGE_SIZE = TIMELINE_QUERY_LIMIT

/** 差分取得の安全マージン (同一 ms に複数アイテムがある場合の取りこぼし防止) */
const CURSOR_MARGIN_MS = 1

/** status を持つべき通知タイプ */
const TYPES_WITH_STATUS = new Set([
  'mention',
  'favourite',
  'reblog',
  'emoji_reaction',
  'poll_expired',
  'status',
  'poll',
  'update',
])

// --------------- 型定義 ---------------

export type UseTimelineListOptions = UseTimelineDataSourceOptions

// --------------- ヘルパー ---------------

/** アイテムの一意キーを生成 */
function itemKey(item: TimelineItem): string {
  if ('post_id' in item)
    return `p:${(item as StatusAddAppIndex & { post_id: number }).post_id}`
  if ('notification_id' in item)
    return `n:${(item as NotificationAddAppIndex & { notification_id: number }).notification_id}`
  return `u:${item.id}`
}

/** アイテムの created_at_ms を取得 */
function itemTimestamp(item: TimelineItem): number {
  if ('created_at_ms' in item) return item.created_at_ms as number
  // fallback: parse ISO 8601 created_at
  if ('created_at' in item && typeof item.created_at === 'string') {
    return new Date(item.created_at).getTime()
  }
  return 0
}

// --------------- メインフック ---------------

export function useTimelineList(
  config: TimelineConfigV2,
  options?: UseTimelineListOptions,
): {
  items: TimelineItem[]
  loadOlder: () => Promise<void>
  isLoadingMore: boolean
  hasMore: boolean
  queryDuration: number | null
} {
  const apps = useContext(AppsContext)
  const { fetchPage, subscribeToChanges, targetBackendUrls } =
    useTimelineDataSource(config, options)

  const { queryDuration, recordDuration } = useQueryDuration()

  // インメモリアイテムマップ (key → item)
  const itemMapRef = useRef(new Map<string, TimelineItem>())
  const [sortedItems, setSortedItems] = useState<TimelineItem[]>([])

  // カーソル追跡
  const newestMsRef = useRef(0)
  const oldestMsRef = useRef(Number.MAX_SAFE_INTEGER)

  // 状態フラグ
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const isLoadingRef = useRef(false)
  const exhaustedBackendsRef = useRef(new Set<string>())

  // 通知を含む mixed タイムラインかどうか
  const includeNotifications = useMemo(() => {
    if (config.type === 'notification') return false // notification は fetchOlderFromApi 内で処理される
    if (config.customQuery?.includes('n.')) return true
    if (config.queryPlan) {
      // queryPlan が notifications テーブルを参照しているか
      const planJson = JSON.stringify(config.queryPlan)
      return planJson.includes('"notifications"')
    }
    return false
  }, [config.customQuery, config.queryPlan, config.type])

  // 初期化完了フラグ
  const initializedRef = useRef(false)

  // config 変更検知
  const configIdRef = useRef(config.id)

  // Map → sorted array 再計算
  const rebuildSortedItems = useCallback(() => {
    const items = [...itemMapRef.current.values()]
    items.sort((a, b) => itemTimestamp(b) - itemTimestamp(a)) // DESC
    setSortedItems(items)
  }, [])

  // Map にアイテムを追加してカーソルを更新
  const addItems = useCallback(
    (newItems: TimelineItem[]) => {
      if (newItems.length === 0) return
      let changed = false
      for (const item of newItems) {
        const key = itemKey(item)
        // 既存アイテムを上書き (編集反映)
        itemMapRef.current.set(key, item)
        changed = true

        const ts = itemTimestamp(item)
        if (ts > newestMsRef.current) newestMsRef.current = ts
        if (ts < oldestMsRef.current) oldestMsRef.current = ts
      }
      if (changed) rebuildSortedItems()
    },
    [rebuildSortedItems],
  )

  // Map をクリアしてカーソルをリセット
  const clearItems = useCallback(() => {
    itemMapRef.current.clear()
    newestMsRef.current = 0
    oldestMsRef.current = Number.MAX_SAFE_INTEGER
    exhaustedBackendsRef.current = new Set()
    setHasMore(true)
    setSortedItems([])
  }, [])

  // config 変更時にクリア
  useEffect(() => {
    if (configIdRef.current !== config.id) {
      configIdRef.current = config.id
      clearItems()
      initializedRef.current = false
    }
  }, [config.id, clearItems])

  // ---- 初期ロード ----
  useEffect(() => {
    if (initializedRef.current) return
    if (options?.disabled) return

    fetchPage({ limit: PAGE_SIZE }).then((result) => {
      if (!result) return // basePlan がまだ null → 次の fetchPage 変更で再試行
      initializedRef.current = true
      recordDuration(result.durationMs)
      addItems(result.items)
      if (result.items.length < PAGE_SIZE) {
        setHasMore(false)
      }
    })
  }, [fetchPage, addItems, recordDuration, options?.disabled])

  // ---- ストリーミング: DB 変更時の差分取得 ----
  useEffect(() => {
    // ストリーミング差分取得
    const onMatched = () => {
      // loadOlder 実行中はストリーミング差分取得をスキップする。
      // fetchOlderFromApi → notifyChange が retry の fetchPage と
      // fetchVersionRef で競合し、retry 結果が破棄される問題を回避する。
      if (isLoadingRef.current) return
      if (newestMsRef.current <= 0) return

      fetchPage({
        cursor: {
          direction: 'after',
          field: 'created_at_ms',
          value: newestMsRef.current - CURSOR_MARGIN_MS,
        },
        limit: PAGE_SIZE,
      }).then((result) => {
        if (!result) return
        recordDuration(result.durationMs)
        addItems(result.items)
      })
    }

    // hintless 変更 (mute/block): 全クリア + 再初期化
    const onHintless = () => {
      clearItems()
      fetchPage({ limit: PAGE_SIZE }).then((result) => {
        if (!result) return
        recordDuration(result.durationMs)
        addItems(result.items)
        if (result.items.length < PAGE_SIZE) {
          setHasMore(false)
        }
      })
    }

    return subscribeToChanges(onMatched, onHintless)
  }, [subscribeToChanges, fetchPage, addItems, clearItems, recordDuration])

  // ---- スクロールバック ----
  const loadOlder = useCallback(async () => {
    if (isLoadingRef.current || !hasMore) return
    isLoadingRef.current = true
    setIsLoadingMore(true)

    try {
      if (oldestMsRef.current >= Number.MAX_SAFE_INTEGER) return

      const currentCount = itemMapRef.current.size

      // DB からカーソル以前のアイテムを取得
      const result = await fetchPage({
        cursor: {
          direction: 'before',
          field: 'created_at_ms',
          value: oldestMsRef.current,
        },
        existingItemCount: currentCount,
        limit: PAGE_SIZE,
      })

      if (result && result.items.length > 0) {
        recordDuration(result.durationMs)
        addItems(result.items)
        if (result.items.length < PAGE_SIZE) {
          // DB に追加データなし → API フォールバック
          await fetchOlderFromApi(
            config,
            apps,
            targetBackendUrls,
            exhaustedBackendsRef.current,
            includeNotifications,
          )
          // API フェッチ後、DB に保存されたデータを再取得
          const retryCount = itemMapRef.current.size
          const retry = await fetchPage({
            cursor: {
              direction: 'before',
              field: 'created_at_ms',
              value: oldestMsRef.current,
            },
            existingItemCount: retryCount,
            limit: PAGE_SIZE,
          })
          if (retry && retry.items.length > 0) {
            addItems(retry.items)
          }
          if (!retry || retry.items.length < PAGE_SIZE) {
            setHasMore(false)
          }
        }
      } else {
        // DB にデータなし → API フォールバック
        await fetchOlderFromApi(
          config,
          apps,
          targetBackendUrls,
          exhaustedBackendsRef.current,
          includeNotifications,
        )
        const retryCount = itemMapRef.current.size
        const retry = await fetchPage({
          cursor: {
            direction: 'before',
            field: 'created_at_ms',
            value: oldestMsRef.current,
          },
          existingItemCount: retryCount,
          limit: PAGE_SIZE,
        })
        if (retry && retry.items.length > 0) {
          addItems(retry.items)
        } else {
          setHasMore(false)
        }
      }
    } finally {
      isLoadingRef.current = false
      setIsLoadingMore(false)
    }
  }, [
    hasMore,
    fetchPage,
    addItems,
    recordDuration,
    config,
    apps,
    targetBackendUrls,
    includeNotifications,
  ])

  // ---- 通知の missing status 取得 ----
  type NotifWithBackend = NotificationAddAppIndex & { backendUrl: string }

  const fetchedNotifIdsRef = useRef(new Set<string>())
  useEffect(() => {
    if (config.type !== 'notification') return
    const notifications = sortedItems.filter(
      (item): item is NotifWithBackend =>
        'type' in item && 'backendUrl' in item,
    )
    const missing = notifications.filter(
      (n) =>
        n.status === undefined &&
        TYPES_WITH_STATUS.has(n.type) &&
        !fetchedNotifIdsRef.current.has(`${n.backendUrl}:${n.id}`),
    )
    if (missing.length === 0) return

    for (const n of missing) {
      const key = `${n.backendUrl}:${n.id}`
      fetchedNotifIdsRef.current.add(key)

      const app = apps.find((a) => a.backendUrl === n.backendUrl)
      if (!app) continue

      const client = GetClient(app)
      client
        .getNotification(n.id)
        .then((res) => addNotification(res.data, n.backendUrl))
        .catch((err) =>
          console.warn('Failed to fetch notification status:', err),
        )
    }
  }, [sortedItems, apps, config.type])

  return {
    hasMore,
    isLoadingMore,
    items: sortedItems,
    loadOlder,
    queryDuration,
  }
}
