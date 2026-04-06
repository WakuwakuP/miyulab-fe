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
  type QueryPlanV2Node,
  queryPlanV2ReferencedTables,
} from 'util/db/query-ir/nodes'
import {
  type ChangeHint,
  getSqliteDb,
  subscribe,
  type TableName,
} from 'util/db/sqlite/connection'
import { rowToStoredNotification } from 'util/db/sqlite/notificationStore'
import {
  assembleStatusFromBatch,
  buildBatchMapsFromResults,
} from 'util/db/sqlite/statusStore'
import { TIMELINE_QUERY_LIMIT } from 'util/environment'
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

// --------------- ヘルパー ---------------

/** appIndex を解決する */
function resolveAppIndex(
  backendUrl: string,
  apps: { backendUrl: string }[],
): number {
  return apps.findIndex((app) => app.backendUrl === backendUrl)
}

/** plan の output-v2 ノードにカーソルと limit をパッチする */
function patchPlanForFetch(
  plan: QueryPlanV2,
  limit: number,
  cursor?: PaginationCursor,
): QueryPlanV2 {
  return {
    ...plan,
    nodes: plan.nodes.map((entry): QueryPlanV2Node => {
      if (entry.node.kind === 'output-v2') {
        return {
          ...entry,
          node: {
            ...entry.node,
            pagination: { ...entry.node.pagination, cursor, limit },
          },
        }
      }
      if (entry.node.kind === 'merge-v2') {
        const mergeLimit = Math.max(entry.node.limit, limit)
        return {
          ...entry,
          node: { ...entry.node, limit: mergeLimit },
        }
      }
      return entry
    }),
  }
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
      const referenced = queryPlanV2ReferencedTables(basePlan)
      if (referenced.has('posts')) tables.add('posts')
      if (referenced.has('notifications')) tables.add('notifications')
    }
    return [...tables]
  }, [config.type, basePlan])

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
      if (options?.disabled) return null
      if (!basePlan || targetBackendUrls.length === 0) {
        // plan が生成できない場合でも初回コールバックを発火
        if (!hasFiredFirstFetchRef.current && options?.onFirstFetch) {
          hasFiredFirstFetchRef.current = true
          options.onFirstFetch()
        }
        return null
      }

      const limit = fetchOptions?.limit ?? TIMELINE_QUERY_LIMIT
      const plan = patchPlanForFetch(basePlan, limit, fetchOptions?.cursor)

      const version = ++fetchVersionRef.current

      try {
        const handle = await getSqliteDb()
        const result = await handle.executeGraphPlan(
          plan as unknown as SerializedGraphPlan,
          { backendUrls: targetBackendUrls },
        )

        if (fetchVersionRef.current !== version) return null

        // --- posts の変換 ---
        let postMap: Map<number, StatusAddAppIndex> | undefined
        if (result.posts.detailRows.length > 0) {
          const maps = buildBatchMapsFromResults(
            result.posts.batchResults as Parameters<
              typeof buildBatchMapsFromResults
            >[0],
          )
          const fallbackAppIndex =
            targetBackendUrls.length > 0
              ? resolveAppIndex(targetBackendUrls[0], apps)
              : -1
          postMap = new Map()
          for (const row of result.posts.detailRows) {
            const status = assembleStatusFromBatch(row, maps)
            let appIndex = resolveAppIndex(status.backendUrl, apps)
            if (
              appIndex < 0 &&
              status.backendUrl === '' &&
              fallbackAppIndex >= 0
            ) {
              appIndex = fallbackAppIndex
              status.backendUrl = targetBackendUrls[0]
            }
            if (appIndex < 0) continue
            postMap.set(status.post_id, { ...status, appIndex })
          }
        }

        // --- notifications の変換 ---
        let notifMap: Map<number, NotificationAddAppIndex> | undefined
        if (result.notifications.detailRows.length > 0) {
          notifMap = new Map()
          for (const row of result.notifications.detailRows) {
            const backendUrl = (row[1] as string) || ''
            const appIndex = resolveAppIndex(backendUrl, apps)
            if (appIndex < 0) continue
            const stored = rowToStoredNotification(row)
            notifMap.set(stored.notification_id, { ...stored, appIndex })
          }
        }

        // --- displayOrder に基づいて結果を組み立て ---
        const items: TimelineItem[] = []
        for (const entry of result.displayOrder) {
          if (entry.table === 'posts' && postMap) {
            const status = postMap.get(entry.id)
            if (status) items.push(status)
          } else if (entry.table === 'notifications' && notifMap) {
            const notif = notifMap.get(entry.id)
            if (notif) items.push(notif)
          }
        }

        // 初回データ取得成功を通知
        if (!hasFiredFirstFetchRef.current && options?.onFirstFetch) {
          hasFiredFirstFetchRef.current = true
          options.onFirstFetch()
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
    [basePlan, targetBackendUrls, apps, options],
  )

  /**
   * DB 変更通知を購読する。
   *
   * @param onMatched — hint がこのタイムラインにマッチしたときのコールバック
   * @param onHintless — hint なしの変更（mute/block 等）のコールバック
   * @returns cleanup 関数
   */
  const subscribeToChanges = useCallback(
    (onMatched: () => void, onHintless: () => void) => {
      const onHints = (hints: ChangeHint[]) => {
        if (hints.length === 0) {
          onHintless()
          return
        }

        const matched = hints.some((hint) => {
          if (hint.timelineType) {
            if (
              !configTimelineTypes.includes(
                hint.timelineType as (typeof configTimelineTypes)[number],
              )
            ) {
              return false
            }
          }
          if (hint.backendUrl) {
            if (!targetBackendUrls.includes(hint.backendUrl)) {
              return false
            }
          }
          return true
        })

        if (matched) {
          onMatched()
        }
      }

      const unsubs = subscribeTables.map((table) => subscribe(table, onHints))
      return () => {
        for (const u of unsubs) u()
      }
    },
    [subscribeTables, configTimelineTypes, targetBackendUrls],
  )

  return {
    apps,
    fetchPage,
    subscribeToChanges,
    targetBackendUrls,
  }
}
