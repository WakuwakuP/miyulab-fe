'use client'

/**
 * useFlatFetchTimeline — フラットフェッチ専用タイムラインフック
 *
 * フローエディタでフィルタ済みの postIds / notificationIds を受け取り、
 * Worker 内で最小限のクエリ + クライアント側 Map 結合で表示データを取得する。
 *
 * `useGraphTimeline` と同じ戻り値型を返すので、UIコンポーネントを共有できる。
 */

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { NotificationAddAppIndex, StatusAddAppIndex } from 'types/types'
import type { FlatFetchRequest } from 'util/db/query-ir/executor/flatFetchTypes'
import {
  type ChangeHint,
  getSqliteDb,
  subscribe,
  type TableName,
} from 'util/db/sqlite/connection'
import { addNotification } from 'util/db/sqlite/notificationStore'
import { GetClient } from 'util/GetClient'
import { useQueryDuration } from 'util/hooks/useQueryDuration'
import { AppsContext } from 'util/provider/AppsProvider'

// --------------- 定数 ---------------

/** status を持つべき通知タイプ */
const TYPES_WITH_STATUS = new Set([
  'mention',
  'favourite',
  'reblog',
  'reaction',
  'poll_expired',
  'status',
  'emoji_reaction',
  'poll',
  'update',
])

/** appIndex を解決する */
function resolveAppIndex(
  backendUrl: string,
  apps: { backendUrl: string }[],
): number {
  return apps.findIndex((app) => app.backendUrl === backendUrl)
}

// --------------- メインフック ---------------

/**
 * フラットフェッチによるタイムラインデータ取得フック。
 *
 * @param request — フラットフェッチリクエスト。null の場合はデータ取得しない。
 * @returns `{ data, queryDuration }`
 */
export function useFlatFetchTimeline(request: FlatFetchRequest | null): {
  data: (NotificationAddAppIndex | StatusAddAppIndex)[]
  queryDuration: number | null
} {
  const apps = useContext(AppsContext)
  const { queryDuration, recordDuration } = useQueryDuration()
  const [data, setData] = useState<
    (NotificationAddAppIndex | StatusAddAppIndex)[]
  >([])

  // race condition 防止
  const fetchVersionRef = useRef(0)

  // リクエストの安定化キー（内容が変わらなければ再実行しない）
  const requestKey = useMemo(
    () => (request ? JSON.stringify(request) : null),
    [request],
  )

  // 購読テーブルの決定
  const subscribeTables = useMemo((): TableName[] => {
    if (!request) return []
    const tables: TableName[] = []
    if (request.postIds.length > 0) {
      tables.push('posts', 'timeline_entries')
    }
    if (request.notificationIds.length > 0) {
      tables.push('notifications')
    }
    return tables
  }, [request])

  // backendUrls の安定参照
  const backendUrls = useMemo(
    () => request?.backendUrls ?? [],
    [request?.backendUrls],
  )

  // ---- メインフェッチ関数 ----

  // biome-ignore lint/correctness/useExhaustiveDependencies: requestKey serializes the full request
  const fetchData = useCallback(async () => {
    if (!request) return
    if (request.postIds.length === 0 && request.notificationIds.length === 0)
      return

    const version = ++fetchVersionRef.current

    try {
      const handle = await getSqliteDb()
      const result = await handle.executeFlatFetch(request)

      // race check
      if (fetchVersionRef.current !== version) return

      recordDuration(result.meta.totalDurationMs)

      // --- displayOrder に基づいて結果を組み立て ---
      const items: (StatusAddAppIndex | NotificationAddAppIndex)[] = []
      for (const entry of result.displayOrder) {
        if (entry.table === 'posts') {
          const status = result.posts.get(entry.id)
          if (!status) continue
          const appIndex = resolveAppIndex(status.backendUrl, apps)
          if (appIndex < 0) continue
          items.push({ ...status, appIndex })
        } else if (entry.table === 'notifications') {
          const notif = result.notifications.get(entry.id)
          if (!notif) continue
          const appIndex = resolveAppIndex(notif.backendUrl, apps)
          if (appIndex < 0) continue
          items.push({ ...notif, appIndex })
        }
      }
      setData(items)
    } catch (e) {
      console.error('[useFlatFetchTimeline] fetch error:', e)
    }
  }, [requestKey, apps, recordDuration])

  // ---- データ取得トリガー ----

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // ---- subscribe: 変更通知で再取得 ----

  useEffect(() => {
    if (subscribeTables.length === 0) return

    const onHints = (hints: ChangeHint[]) => {
      if (hints.length === 0) {
        fetchData()
        return
      }

      const matched = hints.some((hint) => {
        if (hint.backendUrl) {
          if (!backendUrls.includes(hint.backendUrl)) return false
        }
        return true
      })

      if (matched) {
        fetchData()
      }
    }

    const unsubs = subscribeTables.map((table) => subscribe(table, onHints))
    return () => {
      for (const u of unsubs) u()
    }
  }, [fetchData, subscribeTables, backendUrls])

  // ---- 通知の missing status 取得 ----

  type NotifWithBackend = NotificationAddAppIndex & { backendUrl: string }

  const fetchedIdsRef = useRef(new Set<string>())
  useEffect(() => {
    if (!request || request.notificationIds.length === 0) return

    const notifications = data.filter(
      (item): item is NotifWithBackend =>
        'type' in item && 'backendUrl' in item,
    )
    const missing = notifications.filter(
      (n) =>
        n.status === undefined &&
        TYPES_WITH_STATUS.has(n.type) &&
        !fetchedIdsRef.current.has(`${n.backendUrl}:${n.id}`),
    )
    if (missing.length === 0) return

    for (const n of missing) {
      const key = `${n.backendUrl}:${n.id}`
      fetchedIdsRef.current.add(key)

      const app = apps.find((a) => a.backendUrl === n.backendUrl)
      if (!app) continue

      const client = GetClient(app)
      client
        .getNotification(n.id)
        .then((res) => addNotification(res.data, n.backendUrl))
        .catch((err: unknown) =>
          console.warn('Failed to fetch notification status:', err),
        )
    }
  }, [data, apps, request])

  return { data, queryDuration }
}
