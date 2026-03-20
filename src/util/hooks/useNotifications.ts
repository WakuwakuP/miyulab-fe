'use client'

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { NotificationAddAppIndex, TimelineConfigV2 } from 'types/types'
import { getSqliteDb, subscribe } from 'util/db/sqlite/connection'
import {
  addNotification,
  NOTIFICATION_BASE_JOINS,
  NOTIFICATION_SELECT,
  rowToStoredNotification,
  type SqliteStoredNotification,
} from 'util/db/sqlite/notificationStore'
import { TIMELINE_QUERY_LIMIT } from 'util/environment'
import { GetClient } from 'util/GetClient'
import { useQueryDuration } from 'util/hooks/useQueryDuration'
import { AppsContext } from 'util/provider/AppsProvider'
import {
  normalizeBackendFilter,
  resolveBackendUrls,
} from 'util/timelineConfigValidator'
import { useConfigRefresh } from 'util/timelineRefresh'

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

/**
 * backendUrl から appIndex を算出するヘルパー
 *
 * backendUrl が apps に見つからない場合は -1 を返す。
 * 呼び出し側で appIndex === -1 のレコードを除外すること。
 */
function resolveAppIndex(
  backendUrl: string,
  apps: { backendUrl: string }[],
): number {
  return apps.findIndex((app) => app.backendUrl === backendUrl)
}

/**
 * 通知をリアクティブに取得する Hook（SQLite 版）。
 *
 * DB の変更は `subscribe` 経由で再クエリされる。
 *
 * @param config — 省略時は登録済み全アカウントの `backendUrl` を対象にする。
 *   指定時は `backendFilter` に従い対象インスタンスを絞る。`type !== 'notification'` のときは空配列を返す
 * @returns
 * - `data`: `NotificationAddAppIndex[]`（関連 Status が要る種別はバッチで結合）
 * - `queryDuration`: 直近クエリの実行時間（ms）、未計測時は `null`
 * - `loadMore`: 取得件数上限を `TIMELINE_QUERY_LIMIT` 分だけ増やして再取得する
 * @see {@link useTimelineData}
 */
export function useNotifications(config?: TimelineConfigV2): {
  data: NotificationAddAppIndex[]
  queryDuration: number | null
  loadMore: () => void
} {
  const apps = useContext(AppsContext)
  const [notifications, setNotifications] = useState<
    SqliteStoredNotification[]
  >([])
  const [queryLimit, setQueryLimit] = useState(TIMELINE_QUERY_LIMIT)
  const { queryDuration, recordDuration } = useQueryDuration()

  const loadMore = useCallback(() => {
    setQueryLimit((prev) => prev + TIMELINE_QUERY_LIMIT)
  }, [])

  // config 変更時に queryLimit をリセット
  const configId = config?.id
  useEffect(() => {
    // configId の変更を検知して初期値にリセット
    void configId
    setQueryLimit(TIMELINE_QUERY_LIMIT)
  }, [configId])

  // configが渡された場合はbackendFilterを適用、なければ全バックエンド
  const targetBackendUrls = useMemo(() => {
    if (!config) {
      return apps.map((app) => app.backendUrl)
    }
    const filter = normalizeBackendFilter(config.backendFilter, apps)
    return resolveBackendUrls(filter, apps)
  }, [config, apps])

  // 非同期クエリの競合状態を防止するためのバージョンカウンター
  const fetchVersionRef = useRef(0)

  // 設定保存時に確実に再取得をトリガーするためのリフレッシュトークン
  const refreshToken = useConfigRefresh(config?.id ?? '')

  const configType = config?.type

  const fetchData = useCallback(async () => {
    void refreshToken

    // notification タイプ以外ではスキップ（他の Hook が担当する）
    if (configType !== 'notification') {
      setNotifications([])
      return
    }

    // customQuery が設定されている場合は useCustomQueryTimeline に委譲するためスキップ
    if (targetBackendUrls.length === 0 || config?.customQuery?.trim()) {
      setNotifications([])
      return
    }

    const version = ++fetchVersionRef.current

    try {
      const handle = await getSqliteDb()

      const conditions: string[] = []
      const binds: (string | number)[] = []

      // バックエンドフィルタ
      const placeholders = targetBackendUrls.map(() => '?').join(',')
      conditions.push(`sv.base_url IN (${placeholders})`)
      binds.push(...targetBackendUrls)

      // 通知タイプフィルタ
      const notificationFilter = config?.notificationFilter
      if (notificationFilter != null && notificationFilter.length > 0) {
        const typePlaceholders = notificationFilter.map(() => '?').join(',')
        conditions.push(`nt.code IN (${typePlaceholders})`)
        binds.push(...notificationFilter)
      }

      const whereClause = conditions.join(' AND ')
      const sql = `
        SELECT ${NOTIFICATION_SELECT}
        FROM notifications n
        ${NOTIFICATION_BASE_JOINS}
        WHERE ${whereClause}
        ORDER BY n.created_at_ms DESC
        LIMIT ?;
      `
      binds.push(queryLimit)

      const { result: rowsRaw, durationMs } = await handle.execAsyncTimed(sql, {
        bind: binds,
        returnValue: 'resultRows',
      })
      const rows = rowsRaw as (string | number)[][]
      recordDuration(durationMs)

      const results: SqliteStoredNotification[] = rows.map((row) =>
        rowToStoredNotification(row),
      )

      // 古い非同期クエリの結果が新しいクエリの結果を上書きしないようにする
      if (fetchVersionRef.current !== version) return
      setNotifications(results)
    } catch (e) {
      console.error('useNotifications query error:', e)
    }
  }, [
    configType,
    targetBackendUrls,
    config?.customQuery,
    config?.notificationFilter,
    queryLimit,
    recordDuration,
    refreshToken,
  ])

  // 初回取得 + 変更通知で再取得
  useEffect(() => {
    fetchData()
    return subscribe('notifications', fetchData)
  }, [fetchData])

  // status が欠けている通知を検出して API から再取得
  const fetchedIdsRef = useRef(new Set<string>())
  useEffect(() => {
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
        .catch((err) =>
          console.warn('Failed to fetch notification status:', err),
        )
    }
  }, [notifications, apps])

  // appIndex を都度算出して付与し、解決できなかったレコードは除外する
  const data = useMemo(
    () =>
      notifications
        .map((n) => ({
          ...n,
          appIndex: resolveAppIndex(n.backendUrl, apps),
        }))
        .filter((n) => n.appIndex !== -1),
    [notifications, apps],
  )

  return { data, loadMore, queryDuration }
}
