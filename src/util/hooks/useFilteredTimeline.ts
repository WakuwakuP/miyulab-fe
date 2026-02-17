'use client'

import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { StatusAddAppIndex, TimelineConfigV2 } from 'types/types'
import type { TimelineType as DbTimelineType } from 'util/db/database'
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
 * TimelineConfigV2 に基づいてフィルタ済みの Status 配列を返す
 *
 * 対応する type:
 * - 'home' | 'local' | 'public': SQLite JOIN クエリを使用
 * - 'tag': このHookでは扱わない（useFilteredTagTimeline に委譲）
 * - 'notification': このHookでは扱わない
 *
 * ## クエリ戦略
 *
 * backendFilter.mode に応じてクエリ対象の backendUrl を決定し、
 * statuses_timeline_types テーブルとの JOIN で
 * DB 側でソート・フィルタを行う。
 *
 * onlyMedia フィルタは DB カラムに含まれないため、
 * JS 側で適用する（表示層フィルタリング）。
 */
export function useFilteredTimeline(
  config: TimelineConfigV2,
): StatusAddAppIndex[] {
  const apps = useContext(AppsContext)
  const [statuses, setStatuses] = useState<SqliteStoredStatus[]>([])

  // 1. BackendFilter から対象 backendUrls を解決
  const targetBackendUrls = useMemo(() => {
    const filter = normalizeBackendFilter(config.backendFilter, apps)
    return resolveBackendUrls(filter, apps)
  }, [config.backendFilter, apps])

  // 2. SQLite からデータ取得
  const fetchData = useCallback(async () => {
    // tag / notification はそれぞれ専用 Hook で処理するためスキップ
    // customQuery が設定されている場合も useCustomQueryTimeline に委譲するためスキップ
    if (
      config.type === 'tag' ||
      config.type === 'notification' ||
      config.customQuery?.trim()
    ) {
      setStatuses([])
      return
    }
    if (targetBackendUrls.length === 0) {
      setStatuses([])
      return
    }

    try {
      const handle = await getSqliteDb()
      const { db } = handle

      const placeholders = targetBackendUrls.map(() => '?').join(',')
      const sql = `
        SELECT s.compositeKey, s.backendUrl, s.created_at_ms, s.storedAt, s.json
        FROM statuses s
        INNER JOIN statuses_timeline_types stt
          ON s.compositeKey = stt.compositeKey
        WHERE stt.timelineType = ?
          AND s.backendUrl IN (${placeholders})
        ORDER BY s.created_at_ms DESC
        LIMIT ?;
      `
      const binds: (string | number)[] = [
        config.type as DbTimelineType,
        ...targetBackendUrls,
        MAX_LENGTH,
      ]

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

      // 3. onlyMedia フィルタ（JS 側）
      if (config.onlyMedia) {
        results = results.filter(
          (s) => s.media_attachments && s.media_attachments.length > 0,
        )
      }

      setStatuses(results)
    } catch (e) {
      console.error('useFilteredTimeline query error:', e)
      setStatuses([])
    }
  }, [config.type, config.onlyMedia, config.customQuery, targetBackendUrls])

  // 初回取得 + 変更通知で再取得
  useEffect(() => {
    fetchData()
    return subscribe('statuses', fetchData)
  }, [fetchData])

  // 4. appIndex を付与
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
