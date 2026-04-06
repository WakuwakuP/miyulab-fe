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

import type { Dispatch, MutableRefObject, RefObject } from 'react'
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

import { CURSOR_MARGIN_MS } from './itemHelpers'
import type { TimelineListEvent, TimelineListState } from './reducer'

const PAGE_SIZE = TIMELINE_QUERY_LIMIT

type UseTimelineScrollbackControllerArgs = {
  apps: App[]
  config: TimelineConfigV2
  dispatch: Dispatch<TimelineListEvent>
  exhaustedResourcesRef: MutableRefObject<ExhaustedResources>
  fetchPage: (options?: FetchPageOptions) => Promise<FetchPageResult | null>
  includeNotifications: boolean
  recordDuration: (ms: number) => void
  stateRef: RefObject<TimelineListState>
  targetBackendUrls: string[]
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
      if (s.oldestMs >= Number.MAX_SAFE_INTEGER) return

      // DB からカーソル以前のアイテムを取得
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
      // scrollback 完了
      if (stateRef.current.isScrollbackRunning) {
        const hasDeferredStreaming = stateRef.current.deferredStreaming
        dispatch({
          hasMoreOlder: stateRef.current.hasMoreOlder,
          type: 'SCROLLBACK_COMPLETED',
        })

        // 保留されたストリーミング更新を回収
        if (hasDeferredStreaming && stateRef.current.newestMs > 0) {
          fetchPage({
            cursor: {
              direction: 'after',
              field: 'created_at_ms',
              value: stateRef.current.newestMs - CURSOR_MARGIN_MS,
            },
            limit: PAGE_SIZE,
          }).then((result) => {
            if (!result) return
            recordDuration(result.durationMs)
            dispatch({
              items: result.items,
              type: 'DEFERRED_STREAMING_FLUSH_SUCCEEDED',
            })
          })
        }
      }
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
