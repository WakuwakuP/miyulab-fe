'use client'

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { StatusAddAppIndex, TimelineConfigV2 } from 'types/types'
import { getSqliteDb, subscribe } from 'util/db/sqlite/connection'
import type { TimelineType as DbTimelineType } from 'util/db/sqlite/statusStore'
import {
  assembleStatusFromBatch,
  executeBatchQueries,
  type SqliteStoredStatus,
  STATUS_BASE_JOINS,
  STATUS_BASE_SELECT,
} from 'util/db/sqlite/statusStore'
import { TIMELINE_QUERY_LIMIT } from 'util/environment'
import { buildFilterConditions } from 'util/hooks/timelineFilterBuilder'
import { useQueryDuration } from 'util/hooks/useQueryDuration'
import { AppsContext } from 'util/provider/AppsProvider'
import {
  normalizeBackendFilter,
  resolveBackendUrls,
} from 'util/timelineConfigValidator'
import { useConfigRefresh } from 'util/timelineRefresh'

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
 *
 * @param config — タイムライン設定。`type` が `home` / `local` / `public` 以外のときは DB を叩かず空配列を返す
 * @returns
 * - `data`: `StatusAddAppIndex[]`（`appIndex` 解決不能行は除外）
 * - `queryDuration`: 直近クエリの実行時間（ms）、未計測時は `null`
 * - `loadMore`: 取得件数上限を `TIMELINE_QUERY_LIMIT` 分だけ増やして再取得する
 * @see {@link buildFilterConditions}
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

  // 非同期クエリの競合状態を防止するためのバージョンカウンター
  // fetchData が再生成されるたびにインクリメントし、
  // 古いクエリの結果が新しいクエリの結果を上書きしないようにする
  const fetchVersionRef = useRef(0)

  // 設定保存時に確実に再取得をトリガーするためのリフレッシュトークン
  const refreshToken = useConfigRefresh(config.id)

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
        'p', // posts テーブルのエイリアス
        { profileJoined: true },
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
    void refreshToken
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

    const version = ++fetchVersionRef.current

    try {
      const handle = await getSqliteDb()

      const backendPlaceholders = targetBackendUrls.map(() => '?').join(',')

      // === 第1段階: post_id + timelineTypes の取得（軽量クエリ） ===
      const whereConditions = [
        `pb.backendUrl IN (${backendPlaceholders})`,
        ...filterConditions,
      ]

      const phase1Sql = `
        SELECT p.post_id, json_group_array(DISTINCT ck.code) AS timelineTypes
        FROM channel_kinds ck
        INNER JOIN timelines t ON t.channel_kind_id = ck.channel_kind_id
        INNER JOIN timeline_items ti ON ti.timeline_id = t.timeline_id
        INNER JOIN posts p ON p.post_id = ti.post_id
        INNER JOIN posts_backends pb ON p.post_id = pb.post_id
        LEFT JOIN profiles pr ON p.author_profile_id = pr.profile_id
        WHERE ${whereConditions.join('\n          AND ')}
        GROUP BY p.post_id
        HAVING MAX(ck.code = ?) = 1
        ORDER BY p.created_at_ms DESC
        LIMIT ?;
      `
      const phase1Binds: (string | number)[] = [
        ...targetBackendUrls,
        ...filterBinds,
        configType as DbTimelineType,
        queryLimit,
      ]

      const { result: idRowsRaw, durationMs: phase1Duration } =
        await handle.execAsyncTimed(phase1Sql, {
          bind: phase1Binds,
          returnValue: 'resultRows',
        })
      const idRows = idRowsRaw as (string | number | null)[][]

      const postIds = idRows.map((row) => row[0] as number)
      const timelineTypesMap = new Map<number, string>()
      for (const row of idRows) {
        if (row[1] != null) {
          timelineTypesMap.set(row[0] as number, row[1] as string)
        }
      }
      if (postIds.length === 0) {
        recordDuration(phase1Duration)
        if (fetchVersionRef.current !== version) return
        setStatuses([])
        return
      }

      // === 第2段階: 詳細情報の取得（バッチクエリ版） ===
      const placeholders = postIds.map(() => '?').join(',')
      const phase2BaseSql = `
        SELECT ${STATUS_BASE_SELECT}
        FROM posts p
        ${STATUS_BASE_JOINS}
        WHERE p.post_id IN (${placeholders})
        GROUP BY p.post_id
        ORDER BY p.created_at_ms DESC;
      `

      const { result: baseRowsRaw, durationMs: phase2Duration } =
        await handle.execAsyncTimed(phase2BaseSql, {
          bind: postIds,
          returnValue: 'resultRows',
        })
      const baseRows = baseRowsRaw as (string | number | null)[][]

      // リブログ元の post_id を収集
      const reblogPostIds: number[] = []
      for (const row of baseRows) {
        const rbPostId = row[27] as number | null
        if (rbPostId !== null) reblogPostIds.push(rbPostId)
      }
      const allPostIds = [...new Set([...postIds, ...reblogPostIds])]

      // 子テーブルバッチクエリを並列実行
      const maps = await executeBatchQueries(handle, allPostIds)

      // 第1段階で取得した timelineTypes で上書き
      for (const [id, types] of timelineTypesMap) {
        maps.timelineTypesMap.set(id, types)
      }

      recordDuration(phase1Duration + phase2Duration)

      const results: SqliteStoredStatus[] = baseRows.map((row) =>
        assembleStatusFromBatch(row, maps),
      )

      // 古い非同期クエリの結果が新しいクエリの結果を上書きしないようにする
      if (fetchVersionRef.current !== version) return
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
    refreshToken,
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
