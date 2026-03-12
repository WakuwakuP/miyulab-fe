'use client'

import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { StatusAddAppIndex, TimelineConfigV2 } from 'types/types'
import type { TimelineType as DbTimelineType } from 'util/db/database'
import { getSqliteDb, subscribe } from 'util/db/sqlite/connection'
import type { SqliteStoredStatus } from 'util/db/sqlite/statusStore'
import { TIMELINE_QUERY_LIMIT } from 'util/environment'
import { buildFilterConditions } from 'util/hooks/timelineFilterBuilder'
import { useQueryDuration } from 'util/hooks/useQueryDuration'
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
 * posts_timeline_types テーブルとの JOIN で
 * DB 側でソート・フィルタを行う。
 *
 * ## v2 スキーマ対応
 *
 * onlyMedia / visibilityFilter / languageFilter 等のフィルタは
 * 正規化カラムを使って SQL の WHERE 句で直接フィルタする。
 * これにより LIMIT の精度が向上し、JS 側フィルタが不要になる。
 */
export function useFilteredTimeline(config: TimelineConfigV2): {
  data: StatusAddAppIndex[]
  queryDuration: number | null
  loadMore: () => void
} {
  const apps = useContext(AppsContext)
  const [statuses, setStatuses] = useState<SqliteStoredStatus[]>([])
  const [queryLimit, setQueryLimit] = useState(TIMELINE_QUERY_LIMIT)
  const { queryDuration, recordDuration } = useQueryDuration()

  const loadMore = useCallback(() => {
    setQueryLimit((prev) => prev + TIMELINE_QUERY_LIMIT)
  }, [])

  // config 変更時に queryLimit をリセット
  const configId = config.id
  useEffect(() => {
    // configId の変更を検知して初期値にリセット
    void configId
    setQueryLimit(TIMELINE_QUERY_LIMIT)
  }, [configId])

  // 1. BackendFilter から対象 backendUrls を解決
  const targetBackendUrls = useMemo(() => {
    const filter = normalizeBackendFilter(config.backendFilter, apps)
    return resolveBackendUrls(filter, apps)
  }, [config.backendFilter, apps])

  // 2. フィルタ条件を事前計算（useMemo で安定化）
  const {
    onlyMedia,
    minMediaCount,
    visibilityFilter,
    languageFilter,
    excludeReblogs,
    excludeReplies,
    excludeSpoiler,
    excludeSensitive,
    accountFilter,
    applyMuteFilter,
    applyInstanceBlock,
  } = config

  const filterResult = useMemo(
    () =>
      buildFilterConditions(
        {
          accountFilter,
          applyInstanceBlock,
          applyMuteFilter,
          excludeReblogs,
          excludeReplies,
          excludeSensitive,
          excludeSpoiler,
          languageFilter,
          minMediaCount,
          onlyMedia,
          visibilityFilter,
        } as TimelineConfigV2,
        targetBackendUrls,
        '', // マテリアライズド・ビューのサブクエリ内ではテーブルエイリアス不要
      ),
    [
      onlyMedia,
      minMediaCount,
      visibilityFilter,
      languageFilter,
      excludeReblogs,
      excludeReplies,
      excludeSpoiler,
      excludeSensitive,
      accountFilter,
      applyMuteFilter,
      applyInstanceBlock,
      targetBackendUrls,
    ],
  )
  const filterConditions = filterResult.conditions
  const filterBinds = filterResult.binds

  const configType = config.type
  const customQuery = config.customQuery

  // 3. SQLite からデータ取得
  const fetchData = useCallback(async () => {
    // tag / notification はそれぞれ専用 Hook で処理するためスキップ
    // customQuery が設定されている場合も useCustomQueryTimeline に委譲するためスキップ
    if (
      configType === 'tag' ||
      configType === 'notification' ||
      customQuery?.trim()
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

      const backendPlaceholders = targetBackendUrls.map(() => '?').join(',')

      // WHERE 条件を組み立て（timeline_entries のカラムを直接参照）
      const whereConditions = [
        'timelineType = ?',
        `backend_url IN (${backendPlaceholders})`,
        ...filterConditions,
      ]

      // timeline_entries サブクエリで高速に絞り込み＆ソートし、
      // 最後に posts を結合して json を取得する
      const sql = `
        SELECT s.post_id, te.backend_url,
               s.created_at_ms, s.stored_at, s.json
        FROM (
          SELECT post_id, MIN(backend_url) AS backend_url
          FROM timeline_entries
          WHERE ${whereConditions.join('\n            AND ')}
          GROUP BY post_id
          ORDER BY created_at_ms DESC
          LIMIT ?
        ) te
        INNER JOIN posts s ON s.post_id = te.post_id;
      `
      const binds: (string | number)[] = [
        configType as DbTimelineType,
        ...targetBackendUrls,
        ...filterBinds,
        queryLimit,
      ]

      const start = performance.now()
      const rows = (await handle.execAsync(sql, {
        bind: binds,
        returnValue: 'resultRows',
      })) as (string | number)[][]
      recordDuration(performance.now() - start)

      const results: SqliteStoredStatus[] = rows.map((row) => {
        const status = JSON.parse(row[4] as string)
        return {
          ...status,
          backendUrl: row[1] as string,
          belongingTags: [],
          created_at_ms: row[2] as number,
          post_id: row[0] as number,
          storedAt: row[3] as number,
          timelineTypes: [],
        }
      })

      setStatuses(results)
    } catch (e) {
      console.error('useFilteredTimeline query error:', e)
    }
  }, [
    configType,
    customQuery,
    targetBackendUrls,
    filterConditions,
    filterBinds,
    queryLimit,
    recordDuration,
  ])

  // 初回取得 + 変更通知で再取得
  useEffect(() => {
    fetchData()
    return subscribe('posts', fetchData)
  }, [fetchData])

  // 4. appIndex を付与
  const data = useMemo(
    () =>
      statuses
        .map((s) => ({
          ...s,
          appIndex: resolveAppIndex(s.backendUrl, apps),
        }))
        .filter((s) => s.appIndex !== -1),
    [statuses, apps],
  )

  return { data, loadMore, queryDuration }
}
