/**
 * useTimelineStreamingController — ストリーミング差分取得の制御
 *
 * DB 変更通知を受けて、最新ページを再取得する。
 * scrollback 中は取得を保留し、完了後に flush される。
 *
 * 責務:
 * - subscribeToChanges による DB 変更監視
 * - 変更検知時に最新ページを再取得 (reducer の mergeItems で重複排除)
 * - scrollback 中の STREAMING_DEFERRED dispatch
 * - hintless 変更時の再初期化
 *
 * NOTE: カーソルベースの差分取得により、newestMs / newestId 以降のアイテムのみを取得する。
 * changedTables を渡すことで patchPlanForStreamingFetch による選択的テーブルスキャンを活用。
 * mergeItems の Map ベース重複排除により安全にマージされる。
 */

import type { Dispatch, RefObject } from 'react'
import { useEffect } from 'react'

import { tlDebug } from 'util/debug/timelineDebug'
import { TIMELINE_QUERY_LIMIT } from 'util/environment'
import type {
  FetchPageOptions,
  FetchPageResult,
} from 'util/hooks/useTimelineDataSource'

import type { TimelineListEvent, TimelineListState } from './reducer'
import { buildStreamingCursor } from './streamingHelpers'

const PAGE_SIZE = TIMELINE_QUERY_LIMIT

type UseTimelineStreamingControllerArgs = {
  dispatch: Dispatch<TimelineListEvent>
  fetchPage: (options?: FetchPageOptions) => Promise<FetchPageResult | null>
  hasExternalInitialFetch?: boolean
  recordDuration: (ms: number) => void
  stateRef: RefObject<TimelineListState>
  subscribeToChanges: (
    onMatched: (changedTables: ReadonlySet<string>) => void,
    onHintless: () => void,
  ) => () => void
}

export function useTimelineStreamingController({
  dispatch,
  fetchPage,
  hasExternalInitialFetch,
  recordDuration,
  stateRef,
  subscribeToChanges,
}: UseTimelineStreamingControllerArgs): void {
  useEffect(() => {
    const onMatched = (changedTables: ReadonlySet<string>) => {
      const s = stateRef.current
      // scrollback 中は保留
      if (s.isScrollbackRunning) {
        tlDebug('[TL] onMatched: deferred (scrollback running)')
        dispatch({ type: 'STREAMING_DEFERRED' })
        return
      }
      // 初期ロード完了前はスキップ
      if (!s.initialized) {
        tlDebug('[TL] onMatched: skipped (initial load pending)')
        return
      }

      const cursor = buildStreamingCursor(s)
      tlDebug(
        '[TL] onMatched: fetching latest page',
        cursor ? 'with cursor' : 'full',
      )

      fetchPage({ changedTables, cursor, limit: PAGE_SIZE }).then((result) => {
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
        if (!hasExternalInitialFetch && result.items.length < PAGE_SIZE) {
          dispatch({ hasMoreOlder: false, type: 'SCROLLBACK_COMPLETED' })
        }
      })
    }

    return subscribeToChanges(onMatched, onHintless)
  }, [
    subscribeToChanges,
    fetchPage,
    hasExternalInitialFetch,
    recordDuration,
    dispatch,
    stateRef,
  ])
}
