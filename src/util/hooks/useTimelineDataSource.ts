'use client'

/**
 * useTimelineDataSource — タイムラインデータ取得層
 *
 * QueryPlanV2 のカーソル付き実行、結果変換、DB 変更通知購読を担当する。
 * リスト状態管理は行わず、ページ単位の結果を返すのみ。
 *
 * useTimelineList からのみ使用されることを想定。
 */

import { useCallback, useContext, useMemo, useRef } from 'react'

import type {
  NotificationAddAppIndex,
  StatusAddAppIndex,
  TimelineConfigV2,
} from 'types/types'
import { configToQueryPlanV2 } from 'util/db/query-ir/configToQueryPlanV2'
import type { SerializedGraphPlan } from 'util/db/query-ir/executor/types'
import {
  isQueryPlanV2,
  type PaginationCursor,
  type QueryPlanV2,
  queryPlanV2LookupTables,
  queryPlanV2ReferencedTables,
} from 'util/db/query-ir/nodes'
import {
  patchPlanForFetch,
  patchPlanForStreamingFetch,
} from 'util/db/query-ir/patchPlanForFetch'
import {
  type ChangeHint,
  getSqliteDb,
  isTableName,
  subscribe,
  type TableName,
} from 'util/db/sqlite/connection'
import { TIMELINE_QUERY_LIMIT } from 'util/environment'
import { buildTimelineItemsFromGraphResult } from 'util/hooks/buildTimelineItems'
import { hintsMatchTimeline } from 'util/hooks/timelineList'
import { aggregateChangedTables } from 'util/hooks/timelineList/streamingHelpers'
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

// --------------- 型定義 ---------------

export type TimelineItem = StatusAddAppIndex | NotificationAddAppIndex

export type FetchPageOptions = {
  cursor?: PaginationCursor
  limit?: number
  changedTables?: ReadonlySet<string>
}

export type FetchPageResult = {
  items: TimelineItem[]
  durationMs: number
}

export type UseTimelineDataSourceOptions = {
  /** 初回データ取得成功時に呼ばれるコールバック */
  onFirstFetch?: () => void
  /** true の間、データ取得を無効化する */
  disabled?: boolean
}

// --------------- メインフック ---------------

export function useTimelineDataSource(
  config: TimelineConfigV2,
  options?: UseTimelineDataSourceOptions,
) {
  const apps = useContext(AppsContext)

  // バックエンド解決
  const normalizedFilter = useMemo(
    () => normalizeBackendFilter(config.backendFilter, apps),
    [config.backendFilter, apps],
  )
  const targetBackendUrls = useMemo(
    () => resolveBackendUrls(normalizedFilter, apps),
    [normalizedFilter, apps],
  )

  // アカウント解決
  const localAccountIds = useLocalAccountIds(targetBackendUrls)
  const serverIds = useServerIds(targetBackendUrls)

  // 設定リフレッシュトークン
  const _refreshToken = useConfigRefresh(config.id ?? '')

  // race condition 防止
  const fetchVersionRef = useRef(0)

  // onFirstFetch 発火済みフラグ
  const hasFiredFirstFetchRef = useRef(false)

  // options を ref に同期して fetchPage の依存から外す
  const disabledRef = useRef(options?.disabled ?? false)
  disabledRef.current = options?.disabled ?? false
  const onFirstFetchRef = useRef(options?.onFirstFetch)
  onFirstFetchRef.current = options?.onFirstFetch

  // ベースプラン生成 (TIMELINE_QUERY_LIMIT で固定、カーソルなし)
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken は外部からの設定変更を検知するために必要
  const basePlan: QueryPlanV2 | null = useMemo(() => {
    if (config.queryPlan) {
      return config.queryPlan as QueryPlanV2
    }
    if (localAccountIds.length === 0) return null
    return configToQueryPlanV2(config, {
      localAccountIds,
      queryLimit: TIMELINE_QUERY_LIMIT,
      serverIds,
    })
  }, [config, localAccountIds, serverIds, _refreshToken])

  // subscribe 対象テーブル
  const subscribeTables = useMemo((): TableName[] => {
    const tables = new Set<TableName>()
    if (config.type === 'notification') {
      tables.add('notifications')
    } else {
      tables.add('posts')
      tables.add('timeline_entries')
    }
    if (basePlan && isQueryPlanV2(basePlan)) {
      for (const t of queryPlanV2ReferencedTables(basePlan)) {
        if (isTableName(t)) tables.add(t)
      }
    }
    return [...tables]
  }, [config.type, basePlan])

  /** lookupRelated ノードが参照するテーブル（timelineType チェックをスキップする対象） */
  const lookupTables = useMemo((): Set<string> => {
    if (!basePlan || !isQueryPlanV2(basePlan)) return new Set()
    return queryPlanV2LookupTables(basePlan)
  }, [basePlan])

  // ChangeHint マッチング用タイムラインタイプ
  const configTimelineTypes = useMemo(() => {
    if (config.timelineTypes && config.timelineTypes.length > 0) {
      return config.timelineTypes
    }
    return [config.type]
  }, [config.type, config.timelineTypes])

  /**
   * ページ取得: plan にカーソル / limit をパッチして実行し、
   * 結果を StatusAddAppIndex / NotificationAddAppIndex に変換して返す。
   */
  const fetchPage = useCallback(
    async (
      fetchOptions?: FetchPageOptions,
    ): Promise<FetchPageResult | null> => {
      if (disabledRef.current) return null
      if (!basePlan || targetBackendUrls.length === 0) {
        // plan が生成できない場合でも初回コールバックを発火
        if (!hasFiredFirstFetchRef.current && onFirstFetchRef.current) {
          hasFiredFirstFetchRef.current = true
          onFirstFetchRef.current()
        }
        return null
      }

      const limit = fetchOptions?.limit ?? TIMELINE_QUERY_LIMIT
      const plan =
        fetchOptions?.changedTables && fetchOptions?.cursor
          ? patchPlanForStreamingFetch(
              basePlan,
              limit,
              fetchOptions.cursor,
              fetchOptions.changedTables,
            )
          : patchPlanForFetch(basePlan, limit, fetchOptions?.cursor)

      const version = ++fetchVersionRef.current

      try {
        const handle = await getSqliteDb()
        const result = await handle.executeGraphPlan(
          plan as unknown as SerializedGraphPlan,
          { backendUrls: targetBackendUrls },
        )

        if (fetchVersionRef.current !== version) return null

        const items = buildTimelineItemsFromGraphResult(
          result,
          apps,
          targetBackendUrls,
        )

        // 初回データ取得成功を通知
        if (!hasFiredFirstFetchRef.current && onFirstFetchRef.current) {
          hasFiredFirstFetchRef.current = true
          onFirstFetchRef.current()
        }

        return {
          durationMs: result.meta.totalDurationMs,
          items,
        }
      } catch (e) {
        console.error('[useTimelineDataSource] fetch error:', e)
        return null
      }
    },
    [basePlan, targetBackendUrls, apps],
  )

  /**
   * DB 変更通知を購読する。
   *
   * @param onMatched — hint がこのタイムラインにマッチしたときのコールバック
   * @param onHintless — hint なしの変更（mute/block 等）のコールバック
   * @returns cleanup 関数
   */
  const subscribeToChanges = useCallback(
    (
      onMatched: (changedTables: ReadonlySet<string>) => void,
      onHintless: () => void,
    ) => {
      const unsubs = subscribeTables.map((table) => {
        const isLookup = lookupTables.has(table)
        return subscribe(table, (hints: ChangeHint[]) => {
          if (hints.length === 0) {
            onHintless()
            return
          }

          const matched = hintsMatchTimeline(
            hints,
            configTimelineTypes,
            targetBackendUrls,
            isLookup,
          )

          if (matched) {
            onMatched(aggregateChangedTables(hints))
          }
        })
      })
      return () => {
        for (const u of unsubs) u()
      }
    },
    [subscribeTables, lookupTables, configTimelineTypes, targetBackendUrls],
  )

  return {
    apps,
    fetchPage,
    subscribeToChanges,
    targetBackendUrls,
  }
}
