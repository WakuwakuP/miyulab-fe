'use client'

import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { StatusAddAppIndex } from 'types/types'
import type { TimelineType } from 'util/db/database'
import { getSqliteDb, subscribe } from 'util/db/sqlite/connection'
import type { SqliteStoredStatus } from 'util/db/sqlite/statusStore'
import { MAX_LENGTH } from 'util/environment'
import { AppsContext } from 'util/provider/AppsProvider'

/**
 * backendUrl から appIndex を算出するヘルパー
 *
 * appIndex はDBに永続化しないため、表示時に都度算出する。
 * apps の並び替えが行われても常に最新のインデックスが得られる。
 *
 * backendUrl が apps に見つからない場合は -1 を返す。
 * -1 を返すことで、呼び出し側で明示的に除外またはエラー通知を行える。
 * 0 を返すと別アカウント扱いになり、誤った権限で操作されるリスクがある。
 */
function resolveAppIndex(
  backendUrl: string,
  apps: { backendUrl: string }[],
): number {
  return apps.findIndex((app) => app.backendUrl === backendUrl)
}

/**
 * タイムライン種類に応じたStatusをリアクティブに取得するHook (SQLite版)
 *
 * @deprecated useFilteredTimeline を使用してください
 */
export function useTimeline(timelineType: TimelineType): StatusAddAppIndex[] {
  const apps = useContext(AppsContext)
  const [statuses, setStatuses] = useState<SqliteStoredStatus[]>([])

  const backendUrls = useMemo(() => apps.map((app) => app.backendUrl), [apps])

  const fetchData = useCallback(async () => {
    if (backendUrls.length === 0) {
      setStatuses([])
      return
    }

    try {
      const handle = await getSqliteDb()

      const placeholders = backendUrls.map(() => '?').join(',')
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
        timelineType,
        ...backendUrls,
        MAX_LENGTH,
      ]

      const rows = (await handle.execAsync(sql, {
        bind: binds,
        returnValue: 'resultRows',
      })) as (string | number)[][]

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
    } catch (e) {
      console.error('useTimeline query error:', e)
      setStatuses([])
    }
  }, [backendUrls, timelineType])

  useEffect(() => {
    fetchData()
    return subscribe('statuses', fetchData)
  }, [fetchData])

  // appIndex を都度算出して付与し、解決できなかったレコードは除外する
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

/**
 * タグに応じたStatusをリアクティブに取得するHook (SQLite版)
 *
 * @deprecated useFilteredTagTimeline を使用してください
 */
export function useTagTimeline(
  tag: string,
  options?: { onlyMedia?: boolean },
): StatusAddAppIndex[] {
  const apps = useContext(AppsContext)
  const onlyMedia = options?.onlyMedia ?? false
  const [statuses, setStatuses] = useState<SqliteStoredStatus[]>([])

  const backendUrls = useMemo(() => apps.map((app) => app.backendUrl), [apps])

  const fetchData = useCallback(async () => {
    if (backendUrls.length === 0) {
      setStatuses([])
      return
    }

    try {
      const handle = await getSqliteDb()

      const placeholders = backendUrls.map(() => '?').join(',')
      const sql = `
        SELECT s.compositeKey, s.backendUrl, s.created_at_ms, s.storedAt, s.json
        FROM statuses s
        INNER JOIN statuses_belonging_tags sbt
          ON s.compositeKey = sbt.compositeKey
        WHERE sbt.tag = ?
          AND s.backendUrl IN (${placeholders})
        ORDER BY s.created_at_ms DESC
        LIMIT ?;
      `
      const binds: (string | number)[] = [tag, ...backendUrls, MAX_LENGTH]

      const rows = (await handle.execAsync(sql, {
        bind: binds,
        returnValue: 'resultRows',
      })) as (string | number)[][]

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

      if (onlyMedia) {
        results = results.filter(
          (s) => s.media_attachments && s.media_attachments.length > 0,
        )
      }

      setStatuses(results)
    } catch (e) {
      console.error('useTagTimeline query error:', e)
      setStatuses([])
    }
  }, [backendUrls, tag, onlyMedia])

  useEffect(() => {
    fetchData()
    return subscribe('statuses', fetchData)
  }, [fetchData])

  // appIndex を都度算出して付与し、解決できなかったレコードは除外する
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
