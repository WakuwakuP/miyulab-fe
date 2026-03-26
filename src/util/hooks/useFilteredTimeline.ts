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
import {
  type ChangeHint,
  getSqliteDb,
  subscribe,
} from 'util/db/sqlite/connection'
import type { TimelineType as DbTimelineType } from 'util/db/sqlite/statusStore'
import {
  assembleStatusFromBatch,
  BATCH_SQL_TEMPLATES,
  buildBatchMapsFromResults,
  PHASE2_BASE_TEMPLATE,
  type SqliteStoredStatus,
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
  const configType = config.type
  const customQuery = config.customQuery

  // 3. SQLite からデータ取得
  const sessionTag = `filtered-${configId}`

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

    // filterResult は useMemo で安定化済みなので、ここで分解しても安全
    const filterConditions = filterResult.conditions
    const filterBinds = filterResult.binds

    const version = ++fetchVersionRef.current

    try {
      const handle = await getSqliteDb()

      // 前回の fetchData で積んだ未処理クエリは sendRequest の
      // インプレース置換で自動的にキャンセルされるため、
      // cancelStaleRequests の明示呼び出しは不要

      const backendPlaceholders = targetBackendUrls.map(() => '?').join(',')

      // === 第1段階: post_id + timelineTypes + backendUrl の取得（軽量クエリ） ===
      const whereConditions = [
        `pb.backendUrl IN (${backendPlaceholders})`,
        ...filterConditions,
      ]

      const phase1Sql = `
        SELECT p.post_id, json_group_array(DISTINCT ck.code) AS timelineTypes, MIN(pb.backendUrl) AS backendUrl
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

      // === 一括取得: Phase1 → Phase2 → Batch×7 を Worker 内で実行 ===
      const result = await handle.fetchTimeline(
        {
          batchSqls: BATCH_SQL_TEMPLATES,
          phase1: { bind: phase1Binds, sql: phase1Sql },
          phase2BaseSql: PHASE2_BASE_TEMPLATE,
        },
        sessionTag,
      )

      // sendRequest のインプレース置換でキャンセルされた場合 result は undefined になる
      // キャンセルされた場合は早期リターン
      if (!result) return

      const idRows = result.phase1Rows

      const postIds = idRows.map((row) => row[0] as number)
      const timelineTypesMap = new Map<number, string>()
      const backendUrlMap = new Map<number, string>()
      for (const row of idRows) {
        if (row[1] != null) {
          timelineTypesMap.set(row[0] as number, row[1] as string)
        }
        if (row[2] != null) {
          backendUrlMap.set(row[0] as number, row[2] as string)
        }
      }
      if (postIds.length === 0) {
        recordDuration(result.totalDurationMs)
        if (fetchVersionRef.current !== version) return
        setStatuses([])
        return
      }

      // バッチ結果を Map に変換
      const maps = buildBatchMapsFromResults(result.batchResults)

      // 第1段階で取得した timelineTypes で上書き
      for (const [id, types] of timelineTypesMap) {
        maps.timelineTypesMap.set(id, types)
      }

      recordDuration(result.totalDurationMs)

      const results: SqliteStoredStatus[] = result.phase2Rows.map((row) => {
        const status = assembleStatusFromBatch(row, maps)
        const postId = row[0] as number
        status.backendUrl = backendUrlMap.get(postId) ?? status.backendUrl
        return status
      })

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
    filterResult,
    queryLimit,
    recordDuration,
    refreshToken,
    sessionTag,
  ])

  // ヒント付きリスナー: 該当する変更のときだけ fetchData を実行
  const handleChange = useCallback(
    (hints: ChangeHint[]) => {
      // ヒントが空 = ヒントなし通知（ユーザー操作等）→ 常に再取得
      if (hints.length === 0) {
        fetchData()
        return
      }
      // ヒントがある場合: 自パネルに関係する変更かチェック
      const isRelevant = hints.some((hint) => {
        if (hint.timelineType && hint.timelineType !== configType) return false
        if (hint.backendUrl && !targetBackendUrls.includes(hint.backendUrl))
          return false
        return true
      })
      if (isRelevant) {
        fetchData()
      }
    },
    [fetchData, configType, targetBackendUrls],
  )

  // 初回取得 + 変更通知で再取得
  useEffect(() => {
    fetchData()
    return subscribe('posts', handleChange)
  }, [fetchData, handleChange])

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
