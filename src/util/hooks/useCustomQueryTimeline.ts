'use client'

import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { StatusAddAppIndex, TimelineConfigV2 } from 'types/types'
import { getSqliteDb, subscribe } from 'util/db/sqlite/connection'
import type { SqliteStoredStatus } from 'util/db/sqlite/statusStore'
import { MAX_LENGTH } from 'util/environment'
import { AppsContext } from 'util/provider/AppsProvider'

/**
 * backendUrl から appIndex を算出するヘルパー
 */
function resolveAppIndex(
  backendUrl: string,
  apps: { backendUrl: string }[],
): number {
  return apps.findIndex((app) => app.backendUrl === backendUrl)
}

/**
 * カスタム SQL WHERE 句でフィルタした Status を返す Hook
 *
 * config.customQuery が設定されている場合にのみ使用される。
 * LIMIT / OFFSET は自動設定され、ユーザーが指定した値は無視される。
 *
 * backendFilter は customQuery 内に含まれているため、
 * この Hook では別途 backendUrl フィルタを注入しない。
 */
export function useCustomQueryTimeline(
  config: TimelineConfigV2,
): StatusAddAppIndex[] {
  const apps = useContext(AppsContext)
  const [statuses, setStatuses] = useState<SqliteStoredStatus[]>([])

  const customQuery = config.customQuery ?? ''

  const fetchData = useCallback(async () => {
    if (!customQuery.trim()) {
      setStatuses([])
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
        return
      }
      // SQLコメントも拒否
      if (/--/.test(customQuery) || /\/\*/.test(customQuery)) {
        console.error('Custom query contains SQL comments.')
        setStatuses([])
        return
      }
      const sanitized = customQuery
        .replace(/;/g, '')
        .replace(/\bLIMIT\b\s+\d+/gi, '')
        .replace(/\bOFFSET\b\s+\d+/gi, '')
        .trim()

      if (!sanitized) {
        setStatuses([])
        return
      }

      const binds: (string | number)[] = [MAX_LENGTH]

      // backendFilter はクエリ内に含まれているため、別途注入しない
      const sql = `
        SELECT DISTINCT s.compositeKey, s.backendUrl, s.created_at_ms, s.storedAt, s.json
        FROM statuses s
        LEFT JOIN statuses_timeline_types stt
          ON s.compositeKey = stt.compositeKey
        LEFT JOIN statuses_belonging_tags sbt
          ON s.compositeKey = sbt.compositeKey
        WHERE (${sanitized})
        ORDER BY s.created_at_ms DESC
        LIMIT ?;
      `

      const rows = db.exec(sql, {
        bind: binds,
        returnValue: 'resultRows',
      }) as (string | number)[][]

      let results: SqliteStoredStatus[] = rows.map((row) => {
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

      // onlyMedia フィルタ
      if (config.onlyMedia) {
        results = results.filter(
          (s) => s.media_attachments && s.media_attachments.length > 0,
        )
      }

      setStatuses(results)
    } catch (e) {
      console.error('useCustomQueryTimeline query error:', e)
      setStatuses([])
    }
  }, [customQuery, config.onlyMedia])

  useEffect(() => {
    fetchData()
    return subscribe('statuses', fetchData)
  }, [fetchData])

  return useMemo(
    () =>
      statuses
        .map((s) => ({
          ...s,
          appIndex: resolveAppIndex(s.backendUrl, apps),
        }))
        .filter((s) => s.appIndex !== -1),
    [statuses, apps],
  )
}
