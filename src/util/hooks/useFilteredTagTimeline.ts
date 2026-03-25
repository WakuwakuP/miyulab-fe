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

/** 安定した空配列参照（`?? []` による毎レンダー新規参照を防ぐ） */
const EMPTY_TAGS: string[] = []

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
 * SQL の IN 句で一括クエリし、post_id で DISTINCT する。
 *
 * ## AND 条件 (tagConfig.mode === 'and')
 * HAVING COUNT(DISTINCT tag) = タグ数 で全タグを含む Status のみ取得する。
 *
 * ## v2 スキーマ対応
 *
 * onlyMedia / visibilityFilter / languageFilter 等のフィルタは
 * 正規化カラムを使って SQL の WHERE 句で直接フィルタする。
 * これにより LIMIT の精度が向上し、JS 側フィルタが不要になる。
 *
 * @param config — タイムライン設定。`type !== 'tag'` のときは DB を叩かず空配列を返す
 * @returns
 * - `data`: `StatusAddAppIndex[]`（`appIndex` 解決不能行は除外）
 * - `queryDuration`: 直近クエリの実行時間（ms）、未計測時は `null`
 * - `loadMore`: 取得件数上限を `TIMELINE_QUERY_LIMIT` 分だけ増やして再取得する
 * @see {@link buildFilterConditions}
 */
export function useFilteredTagTimeline(config: TimelineConfigV2): {
  data: StatusAddAppIndex[]
  queryDuration: number | null
  loadMore: () => void
} {
  const apps = useContext(AppsContext)
  const tagConfig = config.tagConfig
  const [statuses, setStatuses] = useState<SqliteStoredStatus[]>([])
  const [queryLimit, setQueryLimit] = useState(TIMELINE_QUERY_LIMIT)
  const { queryDuration, recordDuration } = useQueryDuration()

  // 非同期クエリの競合状態を防止するためのバージョンカウンター
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

  const targetBackendUrls = useMemo(() => {
    const filter = normalizeBackendFilter(config.backendFilter, apps)
    return resolveBackendUrls(filter, apps)
  }, [config.backendFilter, apps])

  const tags = tagConfig?.tags ?? EMPTY_TAGS
  const tagMode = tagConfig?.mode ?? 'or'

  // フィルタ条件を事前計算（useMemo で安定化）
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
  const configType = config.type
  const customQuery = config.customQuery

  const fetchData = useCallback(async () => {
    void refreshToken
    // tag 以外の type の場合は早期に空配列を返し、不要な DB クエリを防ぐ
    // customQuery が設定されている場合も useCustomQueryTimeline に委譲するためスキップ
    if (configType !== 'tag' || customQuery?.trim()) {
      setStatuses([])
      return
    }
    if (targetBackendUrls.length === 0 || tags.length === 0) {
      setStatuses([])
      return
    }

    const version = ++fetchVersionRef.current
    const { conditions: filterConditions, binds: filterBinds } = filterResult

    try {
      const handle = await getSqliteDb()

      const backendPlaceholders = targetBackendUrls.map(() => '?').join(',')
      const tagPlaceholders = tags.map(() => '?').join(',')

      // === 第1段階: post_id + backendUrl の取得（軽量クエリ） ===
      let phase1Sql: string
      const phase1Binds: (string | number)[] = []

      if (tagMode === 'or') {
        const whereConditions = [
          `pbt.tag IN (${tagPlaceholders})`,
          `pb.backendUrl IN (${backendPlaceholders})`,
          ...filterConditions,
        ]

        phase1Sql = `
          SELECT p.post_id, MIN(pb.backendUrl) AS backendUrl
          FROM posts p
          INNER JOIN posts_backends pb ON p.post_id = pb.post_id
          LEFT JOIN profiles pr ON p.author_profile_id = pr.profile_id
          INNER JOIN posts_belonging_tags pbt ON p.post_id = pbt.post_id
          WHERE ${whereConditions.join('\n            AND ')}
          GROUP BY p.post_id
          ORDER BY p.created_at_ms DESC
          LIMIT ?;
        `
        phase1Binds.push(
          ...tags,
          ...targetBackendUrls,
          ...filterBinds,
          queryLimit,
        )
      } else {
        const whereConditions = [
          `pbt.tag IN (${tagPlaceholders})`,
          `pb.backendUrl IN (${backendPlaceholders})`,
          ...filterConditions,
        ]

        phase1Sql = `
          SELECT p.post_id, MIN(pb.backendUrl) AS backendUrl
          FROM posts p
          INNER JOIN posts_backends pb ON p.post_id = pb.post_id
          LEFT JOIN profiles pr ON p.author_profile_id = pr.profile_id
          INNER JOIN posts_belonging_tags pbt ON p.post_id = pbt.post_id
          WHERE ${whereConditions.join('\n            AND ')}
          GROUP BY p.post_id
          HAVING COUNT(DISTINCT pbt.tag) = ?
          ORDER BY p.created_at_ms DESC
          LIMIT ?;
        `
        phase1Binds.push(
          ...tags,
          ...targetBackendUrls,
          ...filterBinds,
          tags.length,
          queryLimit,
        )
      }

      const { result: idRowsRaw, durationMs: phase1Duration } =
        await handle.execAsyncTimed(phase1Sql, {
          bind: phase1Binds,
          kind: 'timeline',
          returnValue: 'resultRows',
        })
      const idRows = idRowsRaw as (string | number | null)[][]

      const postIds = idRows.map((row) => row[0] as number)
      const backendUrlMap = new Map<number, string>()
      for (const row of idRows) {
        if (row[1] != null) {
          backendUrlMap.set(row[0] as number, row[1] as string)
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
          kind: 'timeline',
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

      recordDuration(phase1Duration + phase2Duration)

      const results: SqliteStoredStatus[] = baseRows.map((row) => {
        const status = assembleStatusFromBatch(row, maps)
        const postId = row[0] as number
        status.backendUrl = backendUrlMap.get(postId) ?? status.backendUrl
        return status
      })

      // 古い非同期クエリの結果が新しいクエリの結果を上書きしないようにする
      if (fetchVersionRef.current !== version) return
      setStatuses(results)
    } catch (e) {
      console.error('useFilteredTagTimeline query error:', e)
    }
  }, [
    tagMode,
    configType,
    customQuery,
    targetBackendUrls,
    tags,
    filterResult,
    queryLimit,
    recordDuration,
    refreshToken,
  ])

  // 初回取得 + 変更通知で再取得
  useEffect(() => {
    fetchData()
    return subscribe('posts', fetchData)
  }, [fetchData])

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
