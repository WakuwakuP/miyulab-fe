/**
 * useTimelineStreamingController — ストリーミング差分取得の制御
 *
 * DB 変更通知を受けて、newest カーソル以降の差分を取得する。
 * scrollback 中は取得を保留し、完了後に flush される。
 *
 * 責務:
 * - subscribeToChanges による DB 変更監視
 * - after newestMs カーソルで差分取得
 * - scrollback 中の STREAMING_DEFERRED dispatch
 * - hintless 変更時の再初期化
 */

import type { Dispatch, RefObject } from 'react'
import { useEffect } from 'react'

import { tlDebug } from 'util/debug/timelineDebug'
import { TIMELINE_QUERY_LIMIT } from 'util/environment'
import type {
  FetchPageOptions,
  FetchPageResult,
} from 'util/hooks/useTimelineDataSource'

import { CURSOR_MARGIN_MS } from './itemHelpers'
import type { TimelineListEvent, TimelineListState } from './reducer'

const PAGE_SIZE = TIMELINE_QUERY_LIMIT

type UseTimelineStreamingControllerArgs = {
  dispatch: Dispatch<TimelineListEvent>
  fetchPage: (options?: FetchPageOptions) => Promise<FetchPageResult | null>
  recordDuration: (ms: number) => void
  stateRef: RefObject<TimelineListState>
  subscribeToChanges: (
    onMatched: () => void,
    onHintless: () => void,
  ) => () => void
}

export function useTimelineStreamingController({
  dispatch,
  fetchPage,
  recordDuration,
  stateRef,
  subscribeToChanges,
}: UseTimelineStreamingControllerArgs): void {
  useEffect(() => {
    const onMatched = () => {
      const s = stateRef.current
      // scrollback 中は保留
      if (s.isScrollbackRunning) {
        tlDebug('[TL] onMatched: deferred (scrollback running)')
        dispatch({ type: 'STREAMING_DEFERRED' })
        return
      }
      if (s.newestMs <= 0) {
        tlDebug('[TL] onMatched: skipped (newestMs=0, initial load pending)')
        return
      }

      const cursorValue = s.newestMs - CURSOR_MARGIN_MS
      tlDebug('[TL] onMatched: fetching after', cursorValue)

      fetchPage({
        cursor: {
          direction: 'after',
          field: 'created_at_ms',
          value: cursorValue,
        },
        limit: PAGE_SIZE,
      }).then((result) => {
        tlDebug(
          '[TL] onMatched: fetch result',
          result ? result.items.length : 'null',
        )
        if (!result) return
        recordDuration(result.durationMs)
        dispatch({ items: result.items, type: 'STREAMING_FETCH_SUCCEEDED' })
      })
    }

    // hintless 変更 (mute/block): 全クリア + 再初期化
    const onHintless = () => {
      dispatch({ type: 'HINTLESS_INVALIDATED' })
      fetchPage({ limit: PAGE_SIZE }).then((result) => {
        if (!result) return
        recordDuration(result.durationMs)
        dispatch({ items: result.items, type: 'HINTLESS_REFETCH_SUCCEEDED' })
        if (result.items.length < PAGE_SIZE) {
          dispatch({ hasMoreOlder: false, type: 'SCROLLBACK_COMPLETED' })
        }
      })
    }

    return subscribeToChanges(onMatched, onHintless)
  }, [subscribeToChanges, fetchPage, recordDuration, dispatch, stateRef])
}
