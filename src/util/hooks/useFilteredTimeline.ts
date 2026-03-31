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
import { compilePhase1ForTimeline } from 'util/db/query-ir/compat/compilePhase1'
import {
  configToQueryPlan,
  enrichQueryPlan,
} from 'util/db/query-ir/compat/configToNodes'
import {
  type ChangeHint,
  getSqliteDb,
  subscribe,
} from 'util/db/sqlite/connection'
import {
  assembleStatusFromBatch,
  buildBatchMapsFromResults,
  buildPhase2Template,
  buildScopedBatchTemplates,
  buildSpbFilter,
  PHASE2_BASE_TEMPLATE,
  type SqliteStoredStatus,
} from 'util/db/sqlite/statusStore'
import { TIMELINE_QUERY_LIMIT } from 'util/environment'
import { useQueryDuration } from 'util/hooks/useQueryDuration'
import {
  useLocalAccountIds,
  useServerIds,
} from 'util/hooks/useResolvedAccounts'
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
 * timeline_entries テーブルとの JOIN で
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

  // 2. IR パイプライン: config → QueryPlan → Phase1 SQL
  //    queryPlan が保存されている場合は enrichQueryPlan でコンテキストを注入して使用
  const localAccountIds = useLocalAccountIds(targetBackendUrls)
  const serverIds = useServerIds(targetBackendUrls)

  const phase1Result = useMemo(() => {
    const ctx = { localAccountIds, queryLimit, serverIds }
    const plan = config.queryPlan
      ? enrichQueryPlan(config.queryPlan, ctx)
      : configToQueryPlan(config, ctx)
    return compilePhase1ForTimeline(plan)
  }, [config, localAccountIds, serverIds, queryLimit])

  const configType = config.type
  const customQuery = config.customQuery
  const configTimelineTypes = config.timelineTypes
  const hasQueryPlan = config.queryPlan != null

  // 3. SQLite からデータ取得 (IR パイプライン)
  const sessionTag = `filtered-${configId}`

  const fetchData = useCallback(async () => {
    void refreshToken
    // tag / notification はそれぞれ専用 Hook で処理するためスキップ
    // customQuery が設定されている場合は useCustomQueryTimeline に委譲するためスキップ
    // ただし queryPlan が保存されている場合は IR パスで処理するためスキップしない
    if (
      configType === 'tag' ||
      configType === 'notification' ||
      (customQuery?.trim() && !hasQueryPlan)
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

      // === IR コンパイル済み Phase1 SQL を使用 ===
      const { sql: phase1Sql, binds: phase1Binds } = phase1Result

      // === 一括取得: Phase1 → Phase2 → Batch×7 を Worker 内で実行 ===
      const spbFilter = buildSpbFilter(targetBackendUrls)
      const phase2BaseSql = spbFilter
        ? buildPhase2Template(spbFilter)
        : PHASE2_BASE_TEMPLATE

      const result = await handle.fetchTimeline(
        {
          batchSqls: buildScopedBatchTemplates(targetBackendUrls),
          phase1: { bind: phase1Binds, sql: phase1Sql },
          phase2BaseSql,
        },
        sessionTag,
      )

      // sendRequest のインプレース置換でキャンセルされた場合 result は undefined になる
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
    hasQueryPlan,
    targetBackendUrls,
    phase1Result,
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
        if (hint.timelineType) {
          // timelineTypes が設定されている場合はそちらで判定
          const types = configTimelineTypes ?? [configType]
          if (!types.includes(hint.timelineType as never)) return false
        }
        if (hint.backendUrl && !targetBackendUrls.includes(hint.backendUrl))
          return false
        return true
      })
      if (isRelevant) {
        fetchData()
      }
    },
    [fetchData, configType, configTimelineTypes, targetBackendUrls],
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
