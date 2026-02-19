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
import { useQueryDuration } from 'util/hooks/useQueryDuration'
import { AppsContext } from 'util/provider/AppsProvider'
import { isMixedQuery, isNotificationQuery } from 'util/queryBuilder'

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
 * クエリが statuses と notifications の両方のテーブルを参照する場合（混合クエリ）、
 * UNION ALL を使用して両テーブルから結果を取得し、created_at_ms でソートして返す。
 *
 * クエリ内で `n.` プレフィックスのみが使われている場合は notifications テーブルのみ、
 * それ以外の場合は statuses テーブルのみを対象にクエリを実行する。
 *
 * ## v2 スキーマ対応
 *
 * - statuses_mentions (sm) テーブルを LEFT JOIN に追加
 * - onlyMedia フィルタは SQL の has_media カラムで処理（JS 側フィルタ不要）
 * - カスタムクエリモードでは applyMuteFilter / applyInstanceBlock は適用しない
 */
export function useCustomQueryTimeline(config: TimelineConfigV2): {
  data: (NotificationAddAppIndex | StatusAddAppIndex)[]
  averageDuration: number | null
} {
  const apps = useContext(AppsContext)
  const [results, setResults] = useState<
    (
      | (SqliteStoredStatus & { _type: 'status' })
      | (SqliteStoredNotification & { _type: 'notification' })
    )[]
  >([])
  const { averageDuration, recordDuration } = useQueryDuration()

  const customQuery = config.customQuery ?? ''
  const onlyMedia = config.onlyMedia
  const minMediaCount = config.minMediaCount

  const queryMode = useMemo(() => {
    if (isMixedQuery(customQuery)) return 'mixed' as const
    if (isNotificationQuery(customQuery)) return 'notification' as const
    return 'status' as const
  }, [customQuery])

  const fetchData = useCallback(async () => {
    if (!customQuery.trim()) {
      setResults([])
      return
    }

    try {
      const handle = await getSqliteDb()

      // サニタイズ: DML/DDL拒否, セミコロン除去, LIMIT/OFFSET除去
      const forbidden =
        /\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i
      if (forbidden.test(customQuery)) {
        console.error('Custom query contains forbidden SQL statements.')
        setResults([])
        return
      }
      // SQLコメントも拒否（後続の backendUrl 条件のコメントアウト防止）
      if (/--/.test(customQuery) || /\/\*/.test(customQuery)) {
        console.error('Custom query contains SQL comments.')
        setResults([])
        return
      }
      const sanitized = customQuery
        .replace(/;/g, '')
        .replace(/\bLIMIT\b\s+\d+/gi, '')
        .replace(/\bOFFSET\b\s+\d+/gi, '')
        .trim()

      if (!sanitized) {
        setResults([])
        return
      }

      // ? プレースホルダーのバインド競合を防止（文字列リテラル内は許可）
      if (hasUnquotedQuestionMark(sanitized)) {
        console.error('Custom query must not contain ? placeholders.')
        setResults([])
        return
      }

      if (queryMode === 'mixed') {
        // ============================
        // 混合クエリ: statuses + notifications を UNION ALL で結合
        // ============================
        // 各サブクエリでは、対象外テーブルのカラムが NULL になるよう
        // LEFT JOIN ... ON 0 = 1 でダミー結合する

        // statuses サブクエリ用のメディアフィルタ条件
        let statusMediaConditions = ''
        const statusMediaBinds: (string | number)[] = []
        if (minMediaCount != null && minMediaCount > 0) {
          statusMediaConditions += '\n              AND s.media_count >= ?'
          statusMediaBinds.push(minMediaCount)
        } else if (onlyMedia) {
          statusMediaConditions += '\n              AND s.has_media = 1'
        }

        const binds: (string | number)[] = [...statusMediaBinds, MAX_LENGTH]

        const sql = `
          SELECT compositeKey, backendUrl, created_at_ms, storedAt, json, _type
          FROM (
            SELECT s.compositeKey, MIN(sb.backendUrl) AS backendUrl,
                   s.created_at_ms, s.storedAt, s.json,
                   'status' AS _type
            FROM statuses s
            LEFT JOIN statuses_timeline_types stt
              ON s.compositeKey = stt.compositeKey
            LEFT JOIN statuses_belonging_tags sbt
              ON s.compositeKey = sbt.compositeKey
            LEFT JOIN statuses_mentions sm
              ON s.compositeKey = sm.compositeKey
            LEFT JOIN statuses_backends sb
              ON s.compositeKey = sb.compositeKey
            -- Dummy join: n.* columns resolve to NULL so mixed WHERE clause passes
            LEFT JOIN notifications n
              ON 0 = 1
            WHERE (${sanitized})${statusMediaConditions}
            GROUP BY s.compositeKey
            UNION ALL
            SELECT n.compositeKey, n.backendUrl,
                   n.created_at_ms, n.storedAt, n.json,
                   'notification' AS _type
            FROM notifications n
            -- Dummy joins: s.*/stt.*/sbt.*/sm.*/sb.* columns resolve to NULL
            LEFT JOIN statuses s
              ON 0 = 1
            LEFT JOIN statuses_timeline_types stt
              ON 0 = 1
            LEFT JOIN statuses_belonging_tags sbt
              ON 0 = 1
            LEFT JOIN statuses_mentions sm
              ON 0 = 1
            LEFT JOIN statuses_backends sb
              ON 0 = 1
            WHERE (${sanitized})
          )
          ORDER BY created_at_ms DESC
          LIMIT ?;
        `

        const start = performance.now()
        const rows = (await handle.exec(sql, {
          bind: binds,
          returnValue: 'resultRows',
        })) as (string | number)[][]
        recordDuration(performance.now() - start)

        const mixed = rows.map((row) => {
          const type = row[5] as string
          if (type === 'notification') {
            const notification = JSON.parse(row[4] as string)
            return {
              ...notification,
              _type: 'notification' as const,
              backendUrl: row[1] as string,
              compositeKey: row[0] as string,
              created_at_ms: row[2] as number,
              storedAt: row[3] as number,
            }
          }
          const status = JSON.parse(row[4] as string)
          return {
            ...status,
            _type: 'status' as const,
            backendUrl: row[1] as string,
            belongingTags: [],
            compositeKey: row[0] as string,
            created_at_ms: row[2] as number,
            storedAt: row[3] as number,
            timelineTypes: [],
          }
        })

        setResults(mixed)
      } else if (queryMode === 'notification') {
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

        const start = performance.now()
        const rows = (await handle.exec(sql, {
          bind: binds,
          returnValue: 'resultRows',
        })) as (string | number)[][]
        recordDuration(performance.now() - start)

        const notifResults = rows.map((row) => {
          const notification = JSON.parse(row[4] as string)
          return {
            ...notification,
            _type: 'notification' as const,
            backendUrl: row[1] as string,
            compositeKey: row[0] as string,
            created_at_ms: row[2] as number,
            storedAt: row[3] as number,
          }
        })

        setResults(notifResults)
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

        const start = performance.now()
        const rows = (await handle.exec(sql, {
          bind: binds,
          returnValue: 'resultRows',
        })) as (string | number)[][]
        recordDuration(performance.now() - start)

        const statusResults = rows.map((row) => {
          const status = JSON.parse(row[4] as string)
          return {
            ...status,
            _type: 'status' as const,
            backendUrl: row[1] as string,
            belongingTags: [],
            compositeKey: row[0] as string,
            created_at_ms: row[2] as number,
            storedAt: row[3] as number,
            timelineTypes: [],
          }
        })

        setResults(statusResults)
      }
    } catch (e) {
      console.error('useCustomQueryTimeline query error:', e)
      setResults([])
    }
  }, [customQuery, onlyMedia, minMediaCount, queryMode, recordDuration])

  useEffect(() => {
    fetchData()
    // 監視するテーブルはクエリモードに応じて決定
    const unsubStatuses =
      queryMode !== 'notification'
        ? subscribe('statuses', fetchData)
        : undefined
    const unsubNotifications =
      queryMode !== 'status' ? subscribe('notifications', fetchData) : undefined
    return () => {
      unsubStatuses?.()
      unsubNotifications?.()
    }
  }, [fetchData, queryMode])

  const data = useMemo(
    () =>
      results
        .map((item) => ({
          ...item,
          appIndex: resolveAppIndex(item.backendUrl, apps),
        }))
        .filter((item) => item.appIndex !== -1),
    [results, apps],
  )

  return { averageDuration, data }
}
