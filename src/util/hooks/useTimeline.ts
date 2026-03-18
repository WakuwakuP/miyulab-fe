'use client'

import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { StatusAddAppIndex } from 'types/types'
import { getSqliteDb, subscribe } from 'util/db/sqlite/connection'
import type { TimelineType } from 'util/db/sqlite/statusStore'
import {
  rowToStoredStatus,
  type SqliteStoredStatus,
  STATUS_BASE_JOINS,
  STATUS_SELECT,
} from 'util/db/sqlite/statusStore'
import { TIMELINE_QUERY_LIMIT } from 'util/environment'
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
        SELECT ${STATUS_SELECT}
        FROM posts p
        ${STATUS_BASE_JOINS}
        INNER JOIN timeline_items ti ON p.post_id = ti.post_id
        INNER JOIN timelines t ON t.timeline_id = ti.timeline_id
        INNER JOIN channel_kinds ck ON ck.channel_kind_id = t.channel_kind_id
        WHERE ck.code = ?
          AND pb.backendUrl IN (${placeholders})
        GROUP BY p.post_id
        ORDER BY p.created_at_ms DESC
        LIMIT ?;
      `
      const binds: (string | number)[] = [
        timelineType,
        ...backendUrls,
        TIMELINE_QUERY_LIMIT,
      ]

      const rows = (await handle.execAsync(sql, {
        bind: binds,
        returnValue: 'resultRows',
      })) as (string | number | null)[][]

      const results: SqliteStoredStatus[] = rows.map(rowToStoredStatus)

      setStatuses(results)
    } catch (e) {
      console.error('useTimeline query error:', e)
    }
  }, [backendUrls, timelineType])

  useEffect(() => {
    fetchData()
    return subscribe('posts', fetchData)
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
        SELECT ${STATUS_SELECT}
        FROM posts p
        ${STATUS_BASE_JOINS}
        INNER JOIN posts_belonging_tags pbt
          ON p.post_id = pbt.post_id
        WHERE pbt.tag = ?
          AND pb.backendUrl IN (${placeholders})
        GROUP BY p.post_id
        ORDER BY p.created_at_ms DESC
        LIMIT ?;
      `
      const binds: (string | number)[] = [
        tag,
        ...backendUrls,
        TIMELINE_QUERY_LIMIT,
      ]

      const rows = (await handle.execAsync(sql, {
        bind: binds,
        returnValue: 'resultRows',
      })) as (string | number | null)[][]

      let results: SqliteStoredStatus[] = rows.map(rowToStoredStatus)

      if (onlyMedia) {
        results = results.filter(
          (s) => s.media_attachments && s.media_attachments.length > 0,
        )
      }

      setStatuses(results)
    } catch (e) {
      console.error('useTagTimeline query error:', e)
    }
  }, [backendUrls, tag, onlyMedia])

  useEffect(() => {
    fetchData()
    return subscribe('posts', fetchData)
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
