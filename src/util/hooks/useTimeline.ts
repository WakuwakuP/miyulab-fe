'use client'

import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { StatusAddAppIndex } from 'types/types'
import {
  type ChangeHint,
  getSqliteDb,
  subscribe,
} from 'util/db/sqlite/connection'
import type { TimelineType } from 'util/db/sqlite/statusStore'
import {
  buildSpbFilter,
  buildStatusBaseJoins,
  rowToStoredStatus,
  type SqliteStoredStatus,
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
 * タイムライン種類に応じた Status をリアクティブに取得する Hook（SQLite 版）。
 *
 * @deprecated `useFilteredTimeline` を使用してください。
 * @param timelineType — DB の `timeline_entries.timeline_key` に対応するタイムライン種別
 * @returns `appIndex` 付きの `StatusAddAppIndex[]`。`backendUrl` が apps に無い行は除外される
 * @see {@link useFilteredTimeline}
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
      const spbFilter = buildSpbFilter(backendUrls)
      const statusBaseJoins = buildStatusBaseJoins(spbFilter)
      const sql = `
        SELECT ${STATUS_SELECT}
        FROM posts p
        ${statusBaseJoins}
        INNER JOIN timeline_entries te ON p.id = te.post_id
        WHERE te.timeline_key = ?
          AND pb.local_account_id IN (SELECT la.id FROM local_accounts la WHERE la.backend_url IN (${placeholders}))
        GROUP BY p.id
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
        kind: 'timeline',
        returnValue: 'resultRows',
      })) as (string | number | null)[][]

      const results: SqliteStoredStatus[] = rows.map(rowToStoredStatus)

      setStatuses(results)
    } catch (e) {
      console.error('useTimeline query error:', e)
    }
  }, [backendUrls, timelineType])

  // ChangeListener 型は (hints: ChangeHint[]) => void だが、
  // deprecated Hook ではヒントフィルタ不要なので引数を無視する
  const handleChange = useCallback(
    (_hints: ChangeHint[]) => {
      fetchData()
    },
    [fetchData],
  )

  useEffect(() => {
    fetchData()
    return subscribe('posts', handleChange)
  }, [fetchData, handleChange])

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
 * タグに応じた Status をリアクティブに取得する Hook（SQLite 版）。
 *
 * @deprecated `useFilteredTagTimeline` を使用してください。
 * @param tag — 検索するタグ（`hashtags.name` と一致、LOWER() で正規化）
 * @param options — 省略可。`onlyMedia: true` のときメディア付き投稿のみ残す（JS 側フィルタ）
 * @returns `appIndex` 付きの `StatusAddAppIndex[]`。`backendUrl` が apps に無い行は除外される
 * @see {@link useFilteredTagTimeline}
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
      const spbFilterTag = buildSpbFilter(backendUrls)
      const statusBaseJoinsTag = buildStatusBaseJoins(spbFilterTag)
      const sql = `
        SELECT ${STATUS_SELECT}
        FROM posts p
        ${statusBaseJoinsTag}
        INNER JOIN post_hashtags pht ON p.id = pht.post_id
        INNER JOIN hashtags ht ON pht.hashtag_id = ht.id
        WHERE ht.name = LOWER(?)
          AND pb.local_account_id IN (SELECT la.id FROM local_accounts la WHERE la.backend_url IN (${placeholders}))
        GROUP BY p.id
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
        kind: 'timeline',
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

  // ChangeListener 型は (hints: ChangeHint[]) => void だが、
  // deprecated Hook ではヒントフィルタ不要なので引数を無視する
  const handleChange = useCallback(
    (_hints: ChangeHint[]) => {
      fetchData()
    },
    [fetchData],
  )

  useEffect(() => {
    fetchData()
    return subscribe('posts', handleChange)
  }, [fetchData, handleChange])

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
