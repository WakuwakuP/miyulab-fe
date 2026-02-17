'use client'

import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type {
  NotificationAddAppIndex,
  StatusAddAppIndex,
  TimelineConfigV2,
} from 'types/types'
import { getSqliteDb, subscribe } from 'util/db/sqlite/connection'
import type { SqliteStoredNotification } from 'util/db/sqlite/notificationStore'
import type { SqliteStoredStatus } from 'util/db/sqlite/statusStore'
import { MAX_LENGTH } from 'util/environment'
import { AppsContext } from 'util/provider/AppsProvider'
import { isNotificationQuery } from 'util/queryBuilder'

/**
 * backendUrl から appIndex を算出するヘルパー
 */
function resolveAppIndex(
  backendUrl: string,
  apps: { backendUrl: string }[],
): number {
  return apps.findIndex((app) => app.backendUrl === backendUrl)
}

function hasUnquotedQuestionMark(query: string): boolean {
  let inSingleQuote = false

  for (let i = 0; i < query.length; i++) {
    const char = query[i]

    if (char === "'") {
      if (inSingleQuote && query[i + 1] === "'") {
        i++
        continue
      }
      inSingleQuote = !inSingleQuote
      continue
    }

    if (!inSingleQuote && char === '?') {
      return true
    }
  }

  return false
}

/**
 * カスタム SQL WHERE 句でフィルタした Status / Notification を返す Hook
 *
 * config.customQuery が設定されている場合にのみ使用される。
 * LIMIT / OFFSET は自動設定され、ユーザーが指定した値は無視される。
 *
 * クエリ内で `n.` プレフィックスが使われている場合は notifications テーブルを
 * 対象にしたクエリとして実行し、NotificationAddAppIndex[] を返す。
 * それ以外の場合は statuses テーブルを対象にしたクエリとして実行する。
 *
 * ## v2 スキーマ対応
 *
 * - statuses_mentions (sm) テーブルを LEFT JOIN に追加
 * - onlyMedia フィルタは SQL の has_media カラムで処理（JS 側フィルタ不要）
 * - カスタムクエリモードでは applyMuteFilter / applyInstanceBlock は適用しない
 */
export function useCustomQueryTimeline(
  config: TimelineConfigV2,
): NotificationAddAppIndex[] | StatusAddAppIndex[] {
  const apps = useContext(AppsContext)
  const [statuses, setStatuses] = useState<SqliteStoredStatus[]>([])
  const [notifications, setNotifications] = useState<
    SqliteStoredNotification[]
  >([])

  const customQuery = config.customQuery ?? ''
  const onlyMedia = config.onlyMedia
  const minMediaCount = config.minMediaCount

  const isNotifQuery = useMemo(
    () => isNotificationQuery(customQuery),
    [customQuery],
  )

  const fetchData = useCallback(async () => {
    if (!customQuery.trim()) {
      setStatuses([])
      setNotifications([])
      return
    }

    try {
      const handle = await getSqliteDb()
      const { db } = handle

      // サニタイズ: DML/DDL拒否, セミコロン除去, LIMIT/OFFSET除去
      const forbidden =
        /\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i
      if (forbidden.test(customQuery)) {
        console.error('Custom query contains forbidden SQL statements.')
        setStatuses([])
        setNotifications([])
        return
      }
      // SQLコメントも拒否（後続の backendUrl 条件のコメントアウト防止）
      if (/--/.test(customQuery) || /\/\*/.test(customQuery)) {
        console.error('Custom query contains SQL comments.')
        setStatuses([])
        setNotifications([])
        return
      }
      const sanitized = customQuery
        .replace(/;/g, '')
        .replace(/\bLIMIT\b\s+\d+/gi, '')
        .replace(/\bOFFSET\b\s+\d+/gi, '')
        .trim()

      if (!sanitized) {
        setStatuses([])
        setNotifications([])
        return
      }

      // ? プレースホルダーのバインド競合を防止（文字列リテラル内は許可）
      if (hasUnquotedQuestionMark(sanitized)) {
        console.error('Custom query must not contain ? placeholders.')
        setStatuses([])
        setNotifications([])
        return
      }

      if (isNotifQuery) {
        // ============================
        // Notifications クエリ
        // ============================
        const binds: (string | number)[] = [MAX_LENGTH]

        const sql = `
          SELECT n.compositeKey, n.backendUrl,
                 n.created_at_ms, n.storedAt, n.json
          FROM notifications n
          WHERE (${sanitized})
          ORDER BY n.created_at_ms DESC
          LIMIT ?;
        `

        const rows = db.exec(sql, {
          bind: binds,
          returnValue: 'resultRows',
        }) as (string | number)[][]

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
        setStatuses([])
      } else {
        // ============================
        // Statuses クエリ
        // ============================

        // onlyMedia フィルタを SQL 条件として追加
        let additionalConditions = ''
        const additionalBinds: (string | number)[] = []

        if (minMediaCount != null && minMediaCount > 0) {
          additionalConditions += '\n          AND s.media_count >= ?'
          additionalBinds.push(minMediaCount)
        } else if (onlyMedia) {
          additionalConditions += '\n          AND s.has_media = 1'
        }

        const binds: (string | number)[] = [...additionalBinds, MAX_LENGTH]

        // backendUrl フィルタはクエリ自体に含まれるため自動付与しない
        const sql = `
          SELECT s.compositeKey, MIN(sb.backendUrl) AS backendUrl,
                 s.created_at_ms, s.storedAt, s.json
          FROM statuses s
          LEFT JOIN statuses_timeline_types stt
            ON s.compositeKey = stt.compositeKey
          LEFT JOIN statuses_belonging_tags sbt
            ON s.compositeKey = sbt.compositeKey
          LEFT JOIN statuses_mentions sm
            ON s.compositeKey = sm.compositeKey
          LEFT JOIN statuses_backends sb
            ON s.compositeKey = sb.compositeKey
          WHERE (${sanitized})${additionalConditions}
          GROUP BY s.compositeKey
          ORDER BY s.created_at_ms DESC
          LIMIT ?;
        `

        const rows = db.exec(sql, {
          bind: binds,
          returnValue: 'resultRows',
        }) as (string | number)[][]

        const results: SqliteStoredStatus[] = rows.map((row) => {
          const status = JSON.parse(row[4] as string)
          return {
            ...status,
            backendUrl: row[1] as string,
            belongingTags: [],
            compositeKey: row[0] as string,
            created_at_ms: row[2] as number,
            storedAt: row[3] as number,
            timelineTypes: [],
          }
        })

        setStatuses(results)
        setNotifications([])
      }
    } catch (e) {
      console.error('useCustomQueryTimeline query error:', e)
      setStatuses([])
      setNotifications([])
    }
  }, [customQuery, onlyMedia, minMediaCount, isNotifQuery])

  useEffect(() => {
    fetchData()
    // notifications クエリの場合は notifications テーブルの変更も監視する
    const unsubStatuses = subscribe('statuses', fetchData)
    const unsubNotifications = isNotifQuery
      ? subscribe('notifications', fetchData)
      : undefined
    return () => {
      unsubStatuses()
      unsubNotifications?.()
    }
  }, [fetchData, isNotifQuery])

  return useMemo(() => {
    if (isNotifQuery) {
      return notifications
        .map((n) => ({
          ...n,
          appIndex: resolveAppIndex(n.backendUrl, apps),
        }))
        .filter((n) => n.appIndex !== -1)
    }
    return statuses
      .map((s) => ({
        ...s,
        appIndex: resolveAppIndex(s.backendUrl, apps),
      }))
      .filter((s) => s.appIndex !== -1)
  }, [statuses, notifications, apps, isNotifQuery])
}
