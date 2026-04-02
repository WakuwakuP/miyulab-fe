'use client'

/**
 * useGraphTimeline — 統一タイムラインフック
 *
 * TimelineConfigV2 から QueryPlanV2 グラフを生成し、
 * Worker 内で各ノードを個別実行 → Output で Phase2/Phase3 を構築する。
 * useFilteredTimeline / useFilteredTagTimeline / useCustomQueryTimeline /
 * useNotifications の全機能を 1 本のフックに統合する。
 */

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type {
  NotificationAddAppIndex,
  StatusAddAppIndex,
  TimelineConfigV2,
} from 'types/types'
import { configToQueryPlanV2 } from 'util/db/query-ir/configToQueryPlanV2'
import type { SerializedGraphPlan } from 'util/db/query-ir/executor/types'
import type { QueryPlanV2 } from 'util/db/query-ir/nodes'
import {
  type ChangeHint,
  getSqliteDb,
  subscribe,
} from 'util/db/sqlite/connection'
import {
  addNotification,
  rowToStoredNotification,
} from 'util/db/sqlite/notificationStore'
import {
  assembleStatusFromBatch,
  buildBatchMapsFromResults,
} from 'util/db/sqlite/statusStore'
import { TIMELINE_QUERY_LIMIT } from 'util/environment'
import { GetClient } from 'util/GetClient'
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

// --------------- 定数 ---------------

/** status を持つべき通知タイプ */
const TYPES_WITH_STATUS = new Set([
  'mention',
  'favourite',
  'reblog',
  'reaction',
  'poll_expired',
  'status',
  'emoji_reaction',
  'poll',
  'update',
])

/** appIndex を解決する */
function resolveAppIndex(
  backendUrl: string,
  apps: { backendUrl: string }[],
): number {
  return apps.findIndex((app) => app.backendUrl === backendUrl)
}

// --------------- メインフック ---------------

export function useGraphTimeline(config: TimelineConfigV2): {
  data: (NotificationAddAppIndex | StatusAddAppIndex)[]
  queryDuration: number | null
  loadMore: () => void
} {
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

  // ページネーション
  const [queryLimit, setQueryLimit] = useState(TIMELINE_QUERY_LIMIT)
  const loadMore = useCallback(() => {
    setQueryLimit((prev) => prev + TIMELINE_QUERY_LIMIT)
  }, [])

  // 設定リフレッシュトークン
  const refreshToken = useConfigRefresh(config.id ?? '')

  // クエリ実行時間
  const { queryDuration, recordDuration } = useQueryDuration()

  // 結果ステート
  const [data, setData] = useState<
    (NotificationAddAppIndex | StatusAddAppIndex)[]
  >([])

  // race condition 防止
  const fetchVersionRef = useRef(0)

  // QueryPlanV2 生成 (config.queryPlan 優先、なければ自動生成)
  const plan: QueryPlanV2 | null = useMemo(() => {
    if (config.queryPlan) return config.queryPlan as QueryPlanV2
    if (localAccountIds.length === 0) return null
    return configToQueryPlanV2(config, {
      localAccountIds,
      queryLimit,
      serverIds,
    })
  }, [config, localAccountIds, serverIds, queryLimit])

  // subscribeTable の判定
  const subscribeTable = useMemo(() => {
    if (config.type === 'notification') return 'notifications' as const
    return 'posts' as const
  }, [config.type])

  // ChangeHint マッチング用のタイムラインタイプ配列
  const configTimelineTypes = useMemo(() => {
    if (config.timelineTypes && config.timelineTypes.length > 0) {
      return config.timelineTypes
    }
    return [config.type]
  }, [config.type, config.timelineTypes])

  // ---- メインフェッチ関数 ----

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken forces re-fetch on config save
  const fetchData = useCallback(async () => {
    if (!plan) return
    if (targetBackendUrls.length === 0) return

    const version = ++fetchVersionRef.current

    try {
      const handle = await getSqliteDb()
      const result = await handle.executeGraphPlan(
        plan as unknown as SerializedGraphPlan,
        { backendUrls: targetBackendUrls },
      )

      // race check
      if (fetchVersionRef.current !== version) return

      recordDuration(result.meta.totalDurationMs)

      if (result.meta.sourceType === 'notification') {
        // 通知パス
        const notifications: NotificationAddAppIndex[] = []
        for (const row of result.detailRows) {
          const backendUrl = (row[1] as string) || ''
          const appIndex = resolveAppIndex(backendUrl, apps)
          if (appIndex < 0) continue
          const stored = rowToStoredNotification(row)
          notifications.push({ ...stored, appIndex })
        }
        setData(notifications)
      } else {
        // ポストパス
        const maps = buildBatchMapsFromResults(
          result.batchResults as Parameters<
            typeof buildBatchMapsFromResults
          >[0],
        )
        const statuses: StatusAddAppIndex[] = []
        for (const row of result.detailRows) {
          const status = assembleStatusFromBatch(row, maps)
          const appIndex = resolveAppIndex(status.backendUrl, apps)
          if (appIndex < 0) continue
          statuses.push({ ...status, appIndex })
        }
        setData(statuses)
      }
    } catch (e) {
      console.error('[useGraphTimeline] fetch error:', e)
    }
  }, [plan, targetBackendUrls, apps, recordDuration, refreshToken])

  // ---- データ取得トリガー ----

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // ---- subscribe: 変更通知で再取得 ----

  useEffect(() => {
    const unsubscribe = subscribe(subscribeTable, (hints: ChangeHint[]) => {
      // hint なしの場合は常に再取得
      if (hints.length === 0) {
        fetchData()
        return
      }

      // hint マッチング: 1つでもマッチしたら再取得
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
        fetchData()
      }
    })

    return unsubscribe
  }, [fetchData, subscribeTable, configTimelineTypes, targetBackendUrls])

  // ---- 通知の missing status 取得 ----
  // data に含まれる通知は rowToStoredNotification で構築されるため
  // SqliteStoredNotification の backendUrl を持つ
  type NotifWithBackend = NotificationAddAppIndex & { backendUrl: string }

  const fetchedIdsRef = useRef(new Set<string>())
  useEffect(() => {
    if (config.type !== 'notification') return
    const notifications = data.filter(
      (item): item is NotifWithBackend =>
        'type' in item && 'backendUrl' in item,
    )
    const missing = notifications.filter(
      (n) =>
        n.status === undefined &&
        TYPES_WITH_STATUS.has(n.type) &&
        !fetchedIdsRef.current.has(`${n.backendUrl}:${n.id}`),
    )
    if (missing.length === 0) return

    for (const n of missing) {
      const key = `${n.backendUrl}:${n.id}`
      fetchedIdsRef.current.add(key)

      const app = apps.find((a) => a.backendUrl === n.backendUrl)
      if (!app) continue

      const client = GetClient(app)
      client
        .getNotification(n.id)
        .then((res) => addNotification(res.data, n.backendUrl))
        .catch((err) =>
          console.warn('Failed to fetch notification status:', err),
        )
    }
  }, [data, apps, config.type])

  return { data, loadMore, queryDuration }
}
