/**
 * useTimelineScrollbackController — 過去遡り (loadOlder) の制御
 *
 * oldest カーソル以前のアイテムを DB から取得し、
 * 不足時のみ API フォールバックする。
 * 完了後に保留されたストリーミング更新を flush する。
 *
 * 責務:
 * - before oldestMs カーソルで DB 取得
 * - DB 不足時の API フォールバック
 * - exhausted / hasMore 判定
 * - 完了後の deferred streaming flush
 */

import type { Dispatch, RefObject } from 'react'
import { useCallback } from 'react'

import type { App, TimelineConfigV2 } from 'types/types'
import { TIMELINE_QUERY_LIMIT } from 'util/environment'
import type {
  FetchPageOptions,
  FetchPageResult,
} from 'util/hooks/useTimelineDataSource'
import {
  allExhaustedFor,
  type ExhaustedResources,
  fetchOlderFromApi,
} from 'util/timelineFetcher'

import type { TimelineListEvent, TimelineListState } from './reducer'
import {
  NOTIFICATION_READ_CHANGE,
  resolveStreamingFetchWindow,
} from './streamingHelpers'

const PAGE_SIZE = TIMELINE_QUERY_LIMIT

type UseTimelineScrollbackControllerArgs = {
  apps: App[]
  config: TimelineConfigV2
  dispatch: Dispatch<TimelineListEvent>
  exhaustedResourcesRef: RefObject<ExhaustedResources>
  fetchPage: (options?: FetchPageOptions) => Promise<FetchPageResult | null>
  includeNotifications: boolean
  recordDuration: (ms: number) => void
  stateRef: RefObject<TimelineListState>
  targetBackendUrls: string[]
}

/**
 * scrollback 完了を通知し、遡り中に保留されたストリーミング更新を flush する。
 */
function completeScrollback(
  dispatch: Dispatch<TimelineListEvent>,
  fetchPage: (options?: FetchPageOptions) => Promise<FetchPageResult | null>,
  recordDuration: (ms: number) => void,
  stateRef: RefObject<TimelineListState>,
): void {
  if (!stateRef.current.isScrollbackRunning) return
  const flushState = stateRef.current
  const deferredChangedTables = flushState.deferredChangedTables
  dispatch({
    hasMoreOlder: flushState.hasMoreOlder,
    type: 'SCROLLBACK_COMPLETED',
  })

  if (!deferredChangedTables) return
  const { cursor, limit } = resolveStreamingFetchWindow(
    deferredChangedTables,
    flushState,
    PAGE_SIZE,
  )
  const isReadRefresh = deferredChangedTables.has(NOTIFICATION_READ_CHANGE)
  fetchPage({
    changedTables: isReadRefresh ? undefined : deferredChangedTables,
    cursor,
    limit,
  })
    .then((result) => {
      if (!result) return
      recordDuration(result.durationMs)
      dispatch({
        items: result.items,
        type: isReadRefresh
          ? 'NOTIFICATION_READ_REFRESH_SUCCEEDED'
          : 'DEFERRED_STREAMING_FLUSH_SUCCEEDED',
      })
    })
    .catch(() => {
      console.warn('Deferred timeline refresh failed')
    })
}

export function useTimelineScrollbackController({
  apps,
  config,
  dispatch,
  exhaustedResourcesRef,
  fetchPage,
  includeNotifications,
  recordDuration,
  stateRef,
  targetBackendUrls,
}: UseTimelineScrollbackControllerArgs): () => Promise<void> {
  return useCallback(async () => {
    const s = stateRef.current
    if (s.isScrollbackRunning || !s.hasMoreOlder) return
    dispatch({ type: 'SCROLLBACK_STARTED' })

    try {
      // DB からカーソル以前のアイテムを取得
      // oldestMs が MAX_SAFE_INTEGER（アイテム未取得）の場合もスキップせず
      // API フォールバックまで進めて、バックエンド側で枯渇を判定する。
      const result = await fetchPage({
        cursor: {
          direction: 'before',
          field: 'created_at_ms',
          value: stateRef.current.oldestMs,
        },
        limit: PAGE_SIZE,
      })

      if (result && result.items.length >= PAGE_SIZE) {
        recordDuration(result.durationMs)
        dispatch({ items: result.items, type: 'SCROLLBACK_DB_SUCCEEDED' })
        return
      }

      // DB のデータが不足 → まず DB 分を追加してカーソルを更新
      if (result && result.items.length > 0) {
        recordDuration(result.durationMs)
        dispatch({ items: result.items, type: 'SCROLLBACK_DB_SUCCEEDED' })
      }

      // API フォールバック
      await fetchOlderFromApi(
        config,
        apps,
        targetBackendUrls,
        exhaustedResourcesRef.current,
        includeNotifications,
      )

      // 更新されたカーソルで再取得
      const retry = await fetchPage({
        cursor: {
          direction: 'before',
          field: 'created_at_ms',
          value: stateRef.current.oldestMs,
        },
        limit: PAGE_SIZE,
      })

      if (retry && retry.items.length > 0) {
        dispatch({ items: retry.items, type: 'SCROLLBACK_DB_SUCCEEDED' })
      }

      // API が全バックエンドで枯渇 かつ DB にも追加データなし → 終端
      const fetchNotifs = config.type === 'notification' || includeNotifications
      const statusesExhausted =
        config.type === 'notification' ||
        allExhaustedFor(
          exhaustedResourcesRef.current,
          targetBackendUrls,
          'statuses',
        )
      const notifsExhausted =
        !fetchNotifs ||
        allExhaustedFor(
          exhaustedResourcesRef.current,
          targetBackendUrls,
          'notifications',
        )
      const allExhausted = statusesExhausted && notifsExhausted
      if (allExhausted && (!retry || retry.items.length === 0)) {
        dispatch({ hasMoreOlder: false, type: 'SCROLLBACK_COMPLETED' })
        return
      }
    } finally {
      completeScrollback(dispatch, fetchPage, recordDuration, stateRef)
    }
  }, [
    fetchPage,
    recordDuration,
    config,
    apps,
    targetBackendUrls,
    includeNotifications,
    dispatch,
    stateRef,
    exhaustedResourcesRef,
  ])
}
