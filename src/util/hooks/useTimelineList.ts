'use client'

/**
 * useTimelineList — インメモリタイムラインリスト管理 (orchestration)
 *
 * reducer + streaming controller + scrollback controller を組み立て、
 * UI 向けの戻り値を返す。
 *
 * 自身は「何をするか」を組み立てるだけで、
 * 「どう更新するか」は reducer / controller に委譲する。
 */

import { useContext, useEffect, useMemo, useReducer, useRef } from 'react'

import type { TimelineConfigV2 } from 'types/types'
import { TIMELINE_QUERY_LIMIT } from 'util/environment'
import {
  createInitialState,
  timelineListReducer,
  useTimelineScrollbackController,
  useTimelineStreamingController,
} from 'util/hooks/timelineList'
import { useHydrateMissingNotificationStatus } from 'util/hooks/useHydrateMissingNotificationStatus'
import { useQueryDuration } from 'util/hooks/useQueryDuration'
import {
  type TimelineItem,
  type UseTimelineDataSourceOptions,
  useTimelineDataSource,
} from 'util/hooks/useTimelineDataSource'
import { AppsContext } from 'util/provider/AppsProvider'

// --------------- 定数 ---------------

const PAGE_SIZE = TIMELINE_QUERY_LIMIT

// --------------- 型定義 ---------------

export type UseTimelineListOptions = UseTimelineDataSourceOptions

// --------------- メインフック ---------------

export function useTimelineList(
  config: TimelineConfigV2,
  options?: UseTimelineListOptions,
): {
  items: TimelineItem[]
  loadOlder: () => Promise<void>
  isLoadingOlder: boolean
  hasMoreOlder: boolean
  queryDuration: number | null
} {
  const apps = useContext(AppsContext)
  const { fetchPage, subscribeToChanges, targetBackendUrls } =
    useTimelineDataSource(config, options)

  const { queryDuration, recordDuration } = useQueryDuration()

  // --------------- reducer 状態 ---------------
  const [state, dispatch] = useReducer(
    timelineListReducer,
    undefined,
    createInitialState,
  )

  const stateRef = useRef(state)
  stateRef.current = state

  // API フォールバックで枯渇したリソース
  const exhaustedResourcesRef = useRef(
    new Map<string, { notifications: boolean; statuses: boolean }>(),
  )

  // 通知を含む mixed タイムラインかどうか
  const includeNotifications = useMemo(() => {
    if (config.type === 'notification') return false
    if (config.customQuery?.includes('n.')) return true
    if (config.queryPlan) {
      const planJson = JSON.stringify(config.queryPlan)
      return planJson.includes('"notifications"')
    }
    return false
  }, [config.customQuery, config.queryPlan, config.type])

  // home / notification の初期データは StatusStoreProvider が REST API 経由で
  // 非同期に投入するため、DB の初期件数が PAGE_SIZE 未満でも
  // API 側にデータが残っている可能性がある。
  // このフラグが true の場合、初期フェッチの件数だけで hasMoreOlder を
  // false にしない（枯渇判定はスクロールバック時の API チェックに委ねる）。
  const hasExternalInitialFetch =
    config.type === 'home' || config.type === 'notification'

  // config 変更検知
  const configIdRef = useRef(config.id)

  useEffect(() => {
    if (configIdRef.current !== config.id) {
      configIdRef.current = config.id
      exhaustedResourcesRef.current = new Map()
      dispatch({ type: 'RESET' })
    }
  }, [config.id])

  // ---- 初期ロード ----
  useEffect(() => {
    if (stateRef.current.initialized) return
    if (options?.disabled) return

    fetchPage({ limit: PAGE_SIZE }).then((result) => {
      if (!result) return
      recordDuration(result.durationMs)
      if (result.items.length === 0) {
        if (hasExternalInitialFetch) {
          // DB 未投入でも initialized にしつつ hasMoreOlder を維持
          dispatch({ items: [], type: 'INITIAL_FETCH_SUCCEEDED' })
        } else {
          dispatch({ type: 'INITIAL_FETCH_EMPTY' })
        }
      } else {
        dispatch({ items: result.items, type: 'INITIAL_FETCH_SUCCEEDED' })
        if (!hasExternalInitialFetch && result.items.length < PAGE_SIZE) {
          dispatch({ hasMoreOlder: false, type: 'SCROLLBACK_COMPLETED' })
        }
      }
    })
  }, [fetchPage, recordDuration, options?.disabled, hasExternalInitialFetch])

  // ---- ストリーミング controller ----
  useTimelineStreamingController({
    dispatch,
    fetchPage,
    hasExternalInitialFetch,
    recordDuration,
    stateRef,
    subscribeToChanges,
  })

  // ---- スクロールバック controller ----
  const loadOlder = useTimelineScrollbackController({
    apps,
    config,
    dispatch,
    exhaustedResourcesRef,
    fetchPage,
    includeNotifications,
    recordDuration,
    stateRef,
    targetBackendUrls,
  })

  // ---- 通知の missing status 取得 ----
  useHydrateMissingNotificationStatus(state.sortedItems, config.type)

  return {
    hasMoreOlder: state.hasMoreOlder,
    isLoadingOlder: state.isScrollbackRunning,
    items: state.sortedItems,
    loadOlder,
    queryDuration,
  }
}
