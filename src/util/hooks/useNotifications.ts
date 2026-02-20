'use client'

import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { NotificationAddAppIndex, TimelineConfigV2 } from 'types/types'
import { getSqliteDb, subscribe } from 'util/db/sqlite/connection'
import type { SqliteStoredNotification } from 'util/db/sqlite/notificationStore'
import { TIMELINE_QUERY_LIMIT } from 'util/environment'
import { useQueryDuration } from 'util/hooks/useQueryDuration'
import { AppsContext } from 'util/provider/AppsProvider'
import {
  normalizeBackendFilter,
  resolveBackendUrls,
} from 'util/timelineConfigValidator'

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
 * 通知をリアクティブに取得するHook (SQLite版)
 *
 * subscribe/notifyChange による変更通知で再クエリする。
 */
export function useNotifications(config?: TimelineConfigV2): {
  data: NotificationAddAppIndex[]
  averageDuration: number | null
} {
  const apps = useContext(AppsContext)
  const [notifications, setNotifications] = useState<
    SqliteStoredNotification[]
  >([])
  const { averageDuration, recordDuration } = useQueryDuration()

  // configが渡された場合はbackendFilterを適用、なければ全バックエンド
  const targetBackendUrls = useMemo(() => {
    if (!config) {
      return apps.map((app) => app.backendUrl)
    }
    const filter = normalizeBackendFilter(config.backendFilter, apps)
    return resolveBackendUrls(filter, apps)
  }, [config, apps])

  const fetchData = useCallback(async () => {
    // customQuery が設定されている場合は useCustomQueryTimeline に委譲するためスキップ
    if (targetBackendUrls.length === 0 || config?.customQuery?.trim()) {
      setNotifications([])
      return
    }

    try {
      const handle = await getSqliteDb()

      const conditions: string[] = []
      const binds: (string | number)[] = []

      // バックエンドフィルタ
      const placeholders = targetBackendUrls.map(() => '?').join(',')
      conditions.push(`backendUrl IN (${placeholders})`)
      binds.push(...targetBackendUrls)

      // 通知タイプフィルタ
      const notificationFilter = config?.notificationFilter
      if (notificationFilter != null && notificationFilter.length > 0) {
        const typePlaceholders = notificationFilter.map(() => '?').join(',')
        conditions.push(`notification_type IN (${typePlaceholders})`)
        binds.push(...notificationFilter)
      }

      const whereClause = conditions.join(' AND ')
      const sql = `
        SELECT compositeKey, backendUrl, created_at_ms, storedAt, json
        FROM notifications
        WHERE ${whereClause}
        ORDER BY created_at_ms DESC
        LIMIT ?;
      `
      binds.push(TIMELINE_QUERY_LIMIT)

      const start = performance.now()
      const rows = (await handle.execAsync(sql, {
        bind: binds,
        returnValue: 'resultRows',
      })) as (string | number)[][]
      recordDuration(performance.now() - start)

      const results: SqliteStoredNotification[] = rows.map((row) => {
        const notification = JSON.parse(row[4] as string)
        return {
          ...notification,
          backendUrl: row[1] as string,
          compositeKey: row[0] as string,
          created_at_ms: row[2] as number,
          storedAt: row[3] as number,
        }
      })

      setNotifications(results)
    } catch (e) {
      console.error('useNotifications query error:', e)
      setNotifications([])
    }
  }, [
    targetBackendUrls,
    config?.customQuery,
    config?.notificationFilter,
    recordDuration,
  ])

  // 初回取得 + 変更通知で再取得
  useEffect(() => {
    fetchData()
    return subscribe('notifications', fetchData)
  }, [fetchData])

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

  return { averageDuration, data }
}
