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
 * - コアレッシング: フェッチ実行中の変更通知を統合して 1 回のフェッチにまとめる
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
  /** タイムライン設定 ID (sessionTag 生成に使用) */
  configId: string
  dispatch: Dispatch<TimelineListEvent>
  fetchPage: (options?: FetchPageOptions) => Promise<FetchPageResult | null>
  recordDuration: (ms: number) => void
  stateRef: RefObject<TimelineListState>
  subscribeToChanges: (
    onMatched: (changedTables: ReadonlySet<string>) => void,
    onHintless: () => void,
  ) => () => void
}

export function useTimelineStreamingController({
  configId,
  dispatch,
  fetchPage,
  recordDuration,
  stateRef,
  subscribeToChanges,
}: UseTimelineStreamingControllerArgs): void {
  useEffect(() => {
    // ストリーミング取得用の sessionTag
    // 同じパネルの古いリクエストをキュー内でインプレース置換するために使用
    const sessionTag = `streaming:${configId}`

    // コアレッシング状態: フェッチ実行中に到着した変更を統合する
    let pendingFetch = false
    let coalescedChangedTables: Set<string> | null = null

    const doFetch = (changedTables: ReadonlySet<string>) => {
      pendingFetch = true
      const s = stateRef.current
      const cursor = buildStreamingCursor(s)
      tlDebug(
        '[TL] onMatched: fetching latest page',
        cursor ? 'with cursor' : 'full',
      )

      fetchPage({ changedTables, cursor, limit: PAGE_SIZE, sessionTag }).then(
        (result) => {
          tlDebug(
            '[TL] onMatched: fetch result',
            result ? result.items.length : 'null',
          )
          if (result) {
            recordDuration(result.durationMs)
            dispatch({ items: result.items, type: 'STREAMING_FETCH_SUCCEEDED' })
          }

          pendingFetch = false
          // 保留中の変更があればまとめてフェッチ
          if (coalescedChangedTables) {
            const merged = coalescedChangedTables
            coalescedChangedTables = null
            doFetch(merged)
          }
        },
      )
    }

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

      // コアレッシング: フェッチ実行中なら変更テーブルを蓄積して待機
      if (pendingFetch) {
        tlDebug('[TL] onMatched: coalesced (fetch in progress)')
        if (!coalescedChangedTables) {
          coalescedChangedTables = new Set(changedTables)
        } else {
          for (const t of changedTables) {
            coalescedChangedTables.add(t)
          }
        }
        return
      }

      doFetch(changedTables)
    }

    // hintless 変更 (mute/block): 全クリア + 再初期化
    // DB 件数では枯渇を判定しない（スクロールバック時の API 応答に委ねる）
    const onHintless = () => {
      dispatch({ type: 'HINTLESS_INVALIDATED' })
      fetchPage({ limit: PAGE_SIZE }).then((result) => {
        if (!result) return
        recordDuration(result.durationMs)
        dispatch({ items: result.items, type: 'HINTLESS_REFETCH_SUCCEEDED' })
      })
    }

    return subscribeToChanges(onMatched, onHintless)
  }, [
    subscribeToChanges,
    fetchPage,
    recordDuration,
    dispatch,
    stateRef,
    configId,
  ])
}
