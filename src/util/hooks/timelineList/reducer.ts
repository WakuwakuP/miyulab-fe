/**
 * タイムラインリストの状態管理 reducer
 *
 * useTimelineList 内の分散した useRef/useState を統合し、
 * 状態遷移をイベント駆動で明示的に扱う。
 *
 * 副作用 (DB 取得, API フォールバック, subscribe) は含まない。
 * 純粋な状態更新ロジックのみ。
 */

import type { TimelineItem } from 'util/hooks/useTimelineDataSource'

import { itemKey, itemTimestamp, sortItemsDesc } from './itemHelpers'

// --------------- 状態 ---------------

export type TimelineListState = {
  /** ソート済みアイテム配列 (降順) */
  sortedItems: TimelineItem[]
  /** アイテムの一意キー → アイテム Map (dedup 用) */
  itemMap: Map<string, TimelineItem>

  /** ストリーミング差分取得用カーソル (最新アイテムの created_at_ms) */
  newestMs: number
  /** スクロールバック用カーソル (最古アイテムの created_at_ms) */
  oldestMs: number

  /** 初期化完了済みか */
  initialized: boolean
  /** スクロールバック実行中か */
  isScrollbackRunning: boolean
  /** 過去方向にまだ取得可能か */
  hasMoreOlder: boolean

  /** scrollback 中にストリーミング通知が保留されたか */
  deferredStreaming: boolean

  /** API フォールバックで枯渇したリソース (バックエンドURL → リソース種別) */
  exhaustedResources: Map<string, { notifications: boolean; statuses: boolean }>
}

export function createInitialState(): TimelineListState {
  return {
    deferredStreaming: false,
    exhaustedResources: new Map(),
    hasMoreOlder: true,
    initialized: false,
    isScrollbackRunning: false,
    itemMap: new Map(),
    newestMs: 0,
    oldestMs: Number.MAX_SAFE_INTEGER,
    sortedItems: [],
  }
}

// --------------- イベント ---------------

export type TimelineListEvent =
  | { items: TimelineItem[]; type: 'INITIAL_FETCH_SUCCEEDED' }
  | { type: 'INITIAL_FETCH_EMPTY' }
  | { items: TimelineItem[]; type: 'STREAMING_FETCH_SUCCEEDED' }
  | { type: 'STREAMING_DEFERRED' }
  | { items: TimelineItem[]; type: 'DEFERRED_STREAMING_FLUSH_SUCCEEDED' }
  | { type: 'SCROLLBACK_STARTED' }
  | { items: TimelineItem[]; type: 'SCROLLBACK_DB_SUCCEEDED' }
  | { hasMoreOlder: boolean; type: 'SCROLLBACK_COMPLETED' }
  | { type: 'HINTLESS_INVALIDATED' }
  | { items: TimelineItem[]; type: 'HINTLESS_REFETCH_SUCCEEDED' }
  | { type: 'RESET' }

// --------------- reducer ---------------

export function timelineListReducer(
  state: TimelineListState,
  event: TimelineListEvent,
): TimelineListState {
  switch (event.type) {
    case 'INITIAL_FETCH_SUCCEEDED':
      return mergeItems({ ...state, initialized: true }, event.items)

    case 'INITIAL_FETCH_EMPTY':
      return { ...state, hasMoreOlder: false, initialized: true }

    case 'STREAMING_FETCH_SUCCEEDED':
      return mergeItems(state, event.items)

    case 'STREAMING_DEFERRED':
      return { ...state, deferredStreaming: true }

    case 'DEFERRED_STREAMING_FLUSH_SUCCEEDED':
      return mergeItems({ ...state, deferredStreaming: false }, event.items)

    case 'SCROLLBACK_STARTED':
      return { ...state, isScrollbackRunning: true }

    case 'SCROLLBACK_DB_SUCCEEDED':
      return mergeItems(state, event.items)

    case 'SCROLLBACK_COMPLETED':
      return {
        ...state,
        deferredStreaming: false,
        hasMoreOlder: event.hasMoreOlder,
        isScrollbackRunning: false,
      }

    case 'HINTLESS_INVALIDATED':
      return {
        ...createInitialState(),
        initialized: state.initialized,
      }

    case 'HINTLESS_REFETCH_SUCCEEDED':
      return mergeItems(
        { ...createInitialState(), initialized: true },
        event.items,
      )

    case 'RESET':
      return createInitialState()

    default:
      return state
  }
}

// --------------- ヘルパー ---------------

/** アイテムを Map にマージし、カーソルを更新して sortedItems を再生成 */
function mergeItems(
  state: TimelineListState,
  newItems: TimelineItem[],
): TimelineListState {
  if (newItems.length === 0) return state

  // Map を shallow clone して更新
  const nextMap = new Map(state.itemMap)
  let newestMs = state.newestMs
  let oldestMs = state.oldestMs

  for (const item of newItems) {
    nextMap.set(itemKey(item), item)
    const ts = itemTimestamp(item)
    if (ts > newestMs) newestMs = ts
    if (ts < oldestMs) oldestMs = ts
  }

  return {
    ...state,
    itemMap: nextMap,
    newestMs,
    oldestMs,
    sortedItems: sortItemsDesc([...nextMap.values()]),
  }
}
