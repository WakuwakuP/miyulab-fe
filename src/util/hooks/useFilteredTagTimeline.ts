'use client'

import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { StatusAddAppIndex, TimelineConfigV2 } from 'types/types'
import { getSqliteDb, subscribe } from 'util/db/sqlite/connection'
import type { SqliteStoredStatus } from 'util/db/sqlite/statusStore'
import { MAX_LENGTH } from 'util/environment'
import { AppsContext } from 'util/provider/AppsProvider'
import {
  normalizeBackendFilter,
  resolveBackendUrls,
} from 'util/timelineConfigValidator'

/**
 * backendUrl から appIndex を算出するヘルパー
 *
 * appIndex はDBに永続化しないため、表示時に都度算出する。
 * apps の並び替えが行われても常に最新のインデックスが得られる。
 *
 * backendUrl が apps に見つからない場合は -1 を返す。
 */
function resolveAppIndex(
  backendUrl: string,
  apps: { backendUrl: string }[],
): number {
  return apps.findIndex((app) => app.backendUrl === backendUrl)
}

/**
 * タグタイムライン用の統合 Hook (SQLite版)
 *
 * ## OR 条件 (tagConfig.mode === 'or')
 * SQL の IN 句で一括クエリし、compositeKey で DISTINCT する。
 *
 * ## AND 条件 (tagConfig.mode === 'and')
 * HAVING COUNT(DISTINCT tag) = タグ数 で全タグを含む Status のみ取得する。
 */
export function useFilteredTagTimeline(
  config: TimelineConfigV2,
): StatusAddAppIndex[] {
  const apps = useContext(AppsContext)
  const tagConfig = config.tagConfig
  const [statuses, setStatuses] = useState<SqliteStoredStatus[]>([])

  const targetBackendUrls = useMemo(() => {
    const filter = normalizeBackendFilter(config.backendFilter, apps)
    return resolveBackendUrls(filter, apps)
  }, [config.backendFilter, apps])

  const tags = tagConfig?.tags ?? []
  const tagMode = tagConfig?.mode ?? 'or'
  const onlyMedia = config.onlyMedia ?? false

  const fetchData = useCallback(async () => {
    // tag 以外の type の場合は早期に空配列を返し、不要な DB クエリを防ぐ
    // customQuery が設定されている場合も useCustomQueryTimeline に委譲するためスキップ
    if (config.type !== 'tag' || config.customQuery?.trim()) {
      setStatuses([])
      return
    }
    if (targetBackendUrls.length === 0 || tags.length === 0) {
      setStatuses([])
      return
    }

    try {
      const handle = await getSqliteDb()
      const { db } = handle

      const backendPlaceholders = targetBackendUrls.map(() => '?').join(',')
      const tagPlaceholders = tags.map(() => '?').join(',')

      let sql: string
      const binds: (string | number)[] = []

      if (tagMode === 'or') {
        // OR: いずれかのタグを含む
        sql = `
          SELECT DISTINCT s.compositeKey, s.backendUrl, s.created_at_ms, s.storedAt, s.json
          FROM statuses s
          INNER JOIN statuses_belonging_tags sbt
            ON s.compositeKey = sbt.compositeKey
          WHERE sbt.tag IN (${tagPlaceholders})
            AND s.backendUrl IN (${backendPlaceholders})
          ORDER BY s.created_at_ms DESC
          LIMIT ?;
        `
        binds.push(...tags, ...targetBackendUrls, MAX_LENGTH)
      } else {
        // AND: すべてのタグを含む
        sql = `
          SELECT s.compositeKey, s.backendUrl, s.created_at_ms, s.storedAt, s.json
          FROM statuses s
          INNER JOIN statuses_belonging_tags sbt
            ON s.compositeKey = sbt.compositeKey
          WHERE sbt.tag IN (${tagPlaceholders})
            AND s.backendUrl IN (${backendPlaceholders})
          GROUP BY s.compositeKey
          HAVING COUNT(DISTINCT sbt.tag) = ?
          ORDER BY s.created_at_ms DESC
          LIMIT ?;
        `
        binds.push(...tags, ...targetBackendUrls, tags.length, MAX_LENGTH)
      }

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
      if (onlyMedia) {
        results = results.filter(
          (s) => s.media_attachments && s.media_attachments.length > 0,
        )
      }

      setStatuses(results)
    } catch (e) {
      console.error('useFilteredTagTimeline query error:', e)
      setStatuses([])
    }
  }, [
    tagMode,
    onlyMedia,
    config.type,
    config.customQuery,
    targetBackendUrls,
    tags,
  ])

  // 初回取得 + 変更通知で再取得
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
