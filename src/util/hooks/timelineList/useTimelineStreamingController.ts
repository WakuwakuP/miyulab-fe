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
  TimelineItem,
} from 'util/hooks/useTimelineDataSource'

import type { TimelineListEvent, TimelineListState } from './reducer'
import {
  INTERACTION_RELATED_TABLES,
  NOTIFICATION_READ_CHANGE,
  resolveStreamingFetchWindow,
} from './streamingHelpers'

const PAGE_SIZE = TIMELINE_QUERY_LIMIT

type UseTimelineStreamingControllerArgs = {
  /** タイムライン設定 ID (sessionTag 生成に使用) */
  configId: string
  dispatch: Dispatch<TimelineListEvent>
  fetchInteractionUpdates: (
    changedPostIds: ReadonlySet<number>,
    visibleItems: readonly TimelineItem[],
  ) => Promise<FetchPageResult | null>
  fetchPage: (options?: FetchPageOptions) => Promise<FetchPageResult | null>
  recordDuration: (ms: number) => void
  stateRef: RefObject<TimelineListState>
  subscribeToChanges: (
    onMatched: (
      changedTables: ReadonlySet<string>,
      changedPostIds: ReadonlySet<number> | undefined,
    ) => void,
    onHintless: () => void,
  ) => () => void
}

export function createStreamingController({
  configId,
  dispatch,
  fetchInteractionUpdates,
  fetchPage,
  recordDuration,
  stateRef,
  subscribeToChanges,
}: UseTimelineStreamingControllerArgs): () => void {
  // ストリーミング取得用の sessionTag
  // 同じパネルの古いリクエストをキュー内でインプレース置換するために使用
  const sessionTag = `streaming:${configId}`

  let disposed = false
  let generation = 0

  // コアレッシング状態: フェッチ実行中に到着した変更を統合する
  let pendingFetch = false
  let coalescedChangedTables: Set<string> | null = null
  let coalescedPostIds: Set<number> | null = null
  let coalescedPostIdsUnknown = false

  const clearCoalesced = () => {
    coalescedChangedTables = null
    coalescedPostIds = null
    coalescedPostIdsUnknown = false
  }

  const flushCoalesced = () => {
    if (!coalescedChangedTables) return
    const tables = coalescedChangedTables
    const postIds = coalescedPostIdsUnknown
      ? undefined
      : new Set<number>(coalescedPostIds ?? [])
    clearCoalesced()
    onMatched(tables, postIds)
  }

  const doFetch = (changedTables: ReadonlySet<string>) => {
    pendingFetch = true
    const gen = generation
    const s = stateRef.current
    const { cursor, limit } = resolveStreamingFetchWindow(
      changedTables,
      s,
      PAGE_SIZE,
    )
    tlDebug(
      '[TL] onMatched: fetching latest page',
      cursor ? 'with cursor' : 'full',
    )

    const readRefresh = changedTables.has(NOTIFICATION_READ_CHANGE)
    fetchPage({
      changedTables: readRefresh ? undefined : changedTables,
      cursor,
      limit,
      sessionTag,
    })
      .then((result) => {
        if (disposed || gen !== generation) return
        tlDebug(
          '[TL] onMatched: fetch result',
          result ? result.items.length : 'null',
        )
        if (result) {
          recordDuration(result.durationMs)
          dispatch({
            items: result.items,
            type: readRefresh
              ? 'NOTIFICATION_READ_REFRESH_SUCCEEDED'
              : 'STREAMING_FETCH_SUCCEEDED',
          })
        }

        pendingFetch = false
        // 保留中の変更があればまとめてフェッチ
        flushCoalesced()
      })
      .catch(() => {
        if (disposed || gen !== generation) return
        pendingFetch = false
        flushCoalesced()
      })
  }

  const doInteractionRefresh = (
    changedTables: ReadonlySet<string>,
    changedPostIds: ReadonlySet<number>,
  ) => {
    pendingFetch = true
    const gen = generation
    const s = stateRef.current
    tlDebug('[TL] onMatched: interaction refresh', changedPostIds.size)
    fetchInteractionUpdates(changedPostIds, s.sortedItems)
      .then((result) => {
        if (disposed || gen !== generation) return
        if (result === null) {
          pendingFetch = false
          onMatched(changedTables, undefined)
          return
        }
        recordDuration(result.durationMs)
        if (result.items.length > 0) {
          dispatch({
            items: result.items,
            type: 'INTERACTION_UPDATES_SUCCEEDED',
          })
        }
        pendingFetch = false
        flushCoalesced()
      })
      .catch(() => {
        if (disposed || gen !== generation) return
        pendingFetch = false
        onMatched(changedTables, undefined)
      })
  }

  const handleChange = (
    changedTables: ReadonlySet<string>,
    changedPostIds: ReadonlySet<number> | undefined,
  ) => {
    if (
      changedPostIds !== undefined &&
      [...changedTables].every((t) => INTERACTION_RELATED_TABLES.has(t))
    ) {
      doInteractionRefresh(changedTables, changedPostIds)
      return
    }
    doFetch(changedTables)
  }

  const onMatched = (
    changedTables: ReadonlySet<string>,
    changedPostIds: ReadonlySet<number> | undefined,
  ) => {
    const s = stateRef.current
    // scrollback 中は保留
    if (s.isScrollbackRunning) {
      tlDebug('[TL] onMatched: deferred (scrollback running)')
      dispatch({ changedTables, type: 'STREAMING_DEFERRED' })
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
      if (coalescedChangedTables) {
        for (const t of changedTables) {
          coalescedChangedTables.add(t)
        }
      } else {
        coalescedChangedTables = new Set(changedTables)
      }
      if (changedPostIds === undefined) {
        coalescedPostIdsUnknown = true
      } else {
        coalescedPostIds ??= new Set()
        for (const id of changedPostIds) {
          coalescedPostIds.add(id)
        }
      }
      return
    }

    handleChange(changedTables, changedPostIds)
  }

  // hintless 変更 (mute/block): 全クリア + 再初期化
  // DB 件数では枯渇を判定しない（スクロールバック時の API 応答に委ねる）
  const onHintless = () => {
    generation++
    pendingFetch = false
    clearCoalesced()
    dispatch({ type: 'HINTLESS_INVALIDATED' })
    const gen = generation
    fetchPage({ limit: PAGE_SIZE }).then((result) => {
      if (disposed || gen !== generation) return
      if (!result) return
      recordDuration(result.durationMs)
      dispatch({ items: result.items, type: 'HINTLESS_REFETCH_SUCCEEDED' })
    })
  }

  const unsubscribe = subscribeToChanges(onMatched, onHintless)
  return () => {
    disposed = true
    generation++
    pendingFetch = false
    clearCoalesced()
    unsubscribe()
  }
}

export function useTimelineStreamingController({
  configId,
  dispatch,
  fetchInteractionUpdates,
  fetchPage,
  recordDuration,
  stateRef,
  subscribeToChanges,
}: UseTimelineStreamingControllerArgs): void {
  useEffect(
    () =>
      createStreamingController({
        configId,
        dispatch,
        fetchInteractionUpdates,
        fetchPage,
        recordDuration,
        stateRef,
        subscribeToChanges,
      }),
    [
      subscribeToChanges,
      fetchInteractionUpdates,
      fetchPage,
      recordDuration,
      dispatch,
      stateRef,
      configId,
    ],
  )
}
