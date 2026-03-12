'use client'

import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { StatusAddAppIndex, TimelineConfigV2 } from 'types/types'
import type { TimelineType as DbTimelineType } from 'util/db/database'
import { getSqliteDb, subscribe } from 'util/db/sqlite/connection'
import {
  rowToStoredStatus,
  type SqliteStoredStatus,
  STATUS_BASE_JOINS,
  STATUS_SELECT,
} from 'util/db/sqlite/statusStore'
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
 * timeline_items + timelines + channel_kinds テーブルとの JOIN で
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
        's', // posts テーブルのエイリアス
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

      // WHERE 条件を組み立て（posts + JOIN テーブルのカラムを参照）
      const whereConditions = [
        'ck.code = ?',
        `pb.backendUrl IN (${backendPlaceholders})`,
        ...filterConditions,
      ]

      // posts を各テーブルと JOIN し、フィルタ・ソート・LIMIT を適用する
      const sql = `
        SELECT ${STATUS_SELECT}
        FROM posts s
        ${STATUS_BASE_JOINS}
        INNER JOIN timeline_items ti ON s.post_id = ti.post_id
        INNER JOIN timelines t ON t.timeline_id = ti.timeline_id
        INNER JOIN channel_kinds ck ON ck.channel_kind_id = t.channel_kind_id
        WHERE ${whereConditions.join('\n          AND ')}
        GROUP BY s.post_id
        ORDER BY s.created_at_ms DESC
        LIMIT ?;
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

      const results: SqliteStoredStatus[] = rows.map((row) =>
        rowToStoredStatus(row),
      )

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
