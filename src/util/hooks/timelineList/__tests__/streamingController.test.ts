import type { ChangeHint } from 'util/db/sqlite/connection'
import type {
  FetchPageOptions,
  FetchPageResult,
  TimelineItem,
} from 'util/hooks/useTimelineDataSource'
import { describe, expect, it, vi } from 'vitest'

import { CURSOR_MARGIN_MS } from '../itemHelpers'
import {
  createInitialState,
  type TimelineListEvent,
  type TimelineListState,
} from '../reducer'
import {
  aggregateChangedTables,
  buildStreamingCursor,
  resolveStreamingFetchWindow,
  shouldBypassStreamingCursor,
} from '../streamingHelpers'
import { createStreamingController } from '../useTimelineStreamingController'

// --------------- aggregateChangedTables ---------------

describe('aggregateChangedTables', () => {
  it('changedTables aggregation — multiple hints with different changedTables are unioned into a single Set', () => {
    const hints: ChangeHint[] = [
      {
        backendUrl: 'https://a.com',
        changedTables: ['posts', 'accounts'],
        timelineType: 'home',
      },
      {
        backendUrl: 'https://b.com',
        changedTables: ['timeline_entries', 'notifications'],
        timelineType: 'home',
      },
    ]
    const result = aggregateChangedTables(hints)
    expect(result).toEqual(
      new Set(['posts', 'accounts', 'timeline_entries', 'notifications']),
    )
  })

  it('returns empty set when hints have no changedTables', () => {
    const hints: ChangeHint[] = [
      { backendUrl: 'https://a.com', timelineType: 'home' },
      { backendUrl: 'https://b.com', timelineType: 'public' },
    ]
    const result = aggregateChangedTables(hints)
    expect(result.size).toBe(0)
  })

  it('deduplicates table names across hints', () => {
    const hints: ChangeHint[] = [
      { changedTables: ['posts', 'accounts'], timelineType: 'home' },
      { changedTables: ['posts', 'timeline_entries'], timelineType: 'home' },
    ]
    const result = aggregateChangedTables(hints)
    expect(result).toEqual(new Set(['posts', 'accounts', 'timeline_entries']))
    expect(result.size).toBe(3)
  })
})

// --------------- buildStreamingCursor ---------------

describe('buildStreamingCursor', () => {
  it('cursor built from newestMs — when newestMs > 0, returns created_at_ms cursor with CURSOR_MARGIN_MS applied', () => {
    const cursor = buildStreamingCursor({ newestId: 0, newestMs: 1000 })
    expect(cursor).toEqual({
      direction: 'after',
      field: 'created_at_ms',
      value: 1000 - CURSOR_MARGIN_MS,
    })
  })

  it('cursor built from newestId fallback — when newestMs === 0 but newestId > 0, returns id cursor', () => {
    const cursor = buildStreamingCursor({ newestId: 42, newestMs: 0 })
    expect(cursor).toEqual({
      direction: 'after',
      field: 'id',
      value: 42,
    })
  })

  it('no cursor when uninitialized — when newestMs === 0 and newestId === 0, returns undefined', () => {
    const cursor = buildStreamingCursor({ newestId: 0, newestMs: 0 })
    expect(cursor).toBeUndefined()
  })

  it('CURSOR_MARGIN_MS applied — cursor value is newestMs - CURSOR_MARGIN_MS (= 1)', () => {
    expect(CURSOR_MARGIN_MS).toBe(1)
    const cursor = buildStreamingCursor({ newestId: 0, newestMs: 5000 })
    expect(cursor).toBeDefined()
    expect(cursor?.value).toBe(5000 - 1)
  })
})

// --------------- shouldBypassStreamingCursor ---------------

describe('shouldBypassStreamingCursor', () => {
  it('post_interactions 単独変更では既存 column item 更新のため cursor を使わない', () => {
    expect(shouldBypassStreamingCursor(new Set(['post_interactions']))).toBe(
      true,
    )
  })

  it('posts / timeline_entries だけの変更では cursor 差分取得を維持する', () => {
    expect(
      shouldBypassStreamingCursor(new Set(['posts', 'timeline_entries'])),
    ).toBe(false)
  })

  it('post_interactions が通常 upsert と一緒に来た場合は cursor 差分取得を維持する', () => {
    expect(
      shouldBypassStreamingCursor(new Set(['posts', 'post_interactions'])),
    ).toBe(false)
  })
})

// --------------- resolveStreamingFetchWindow ---------------

describe('resolveStreamingFetchWindow', () => {
  it('post_interactions 単独変更では cursor なしで表示件数より広い window を取得する', () => {
    const result = resolveStreamingFetchWindow(
      new Set(['post_interactions']),
      {
        newestId: 20,
        newestMs: 5000,
        sortedItems: Array.from({ length: 80 }),
      },
      40,
    )

    expect(result).toEqual({
      cursor: undefined,
      limit: 120,
    })
  })

  it('post_interactions 単独変更で表示中 item がない場合は PAGE_SIZE を維持する', () => {
    const result = resolveStreamingFetchWindow(
      new Set(['post_interactions']),
      {
        newestId: 20,
        newestMs: 5000,
        sortedItems: [],
      },
      40,
    )

    expect(result).toEqual({
      cursor: undefined,
      limit: 40,
    })
  })

  it('通常 upsert では cursor 付き PAGE_SIZE 取得を維持する', () => {
    const result = resolveStreamingFetchWindow(
      new Set(['posts', 'post_interactions']),
      {
        newestId: 20,
        newestMs: 5000,
        sortedItems: Array.from({ length: 80 }),
      },
      40,
    )

    expect(result).toEqual({
      cursor: {
        direction: 'after',
        field: 'created_at_ms',
        value: 5000 - CURSOR_MARGIN_MS,
      },
      limit: 40,
    })
  })
})

type ControllerHarnessOptions = {
  fetchInteractionUpdates?: (
    changedPostIds: ReadonlySet<number>,
    visibleItems: readonly TimelineItem[],
  ) => Promise<FetchPageResult | null>
  fetchPage?: (options?: FetchPageOptions) => Promise<FetchPageResult | null>
  state?: Partial<TimelineListState>
}

function setupController(options?: ControllerHarnessOptions) {
  const events: TimelineListEvent[] = []
  const state: TimelineListState = {
    ...createInitialState(),
    initialized: true,
    ...options?.state,
  }
  const callbacks: {
    hintless?: () => void
    matched?: (
      changedTables: ReadonlySet<string>,
      changedPostIds: ReadonlySet<number> | undefined,
    ) => void
  } = {}
  const fetchPage =
    options?.fetchPage ??
    vi.fn(async () => ({ durationMs: 1, items: [] as TimelineItem[] }))
  const fetchInteractionUpdates =
    options?.fetchInteractionUpdates ?? vi.fn(async () => null)
  const unsubscribe = vi.fn()
  const dispose = createStreamingController({
    configId: 'cfg-1',
    dispatch: (event) => events.push(event),
    fetchInteractionUpdates,
    fetchPage,
    recordDuration: vi.fn(),
    stateRef: { current: state },
    subscribeToChanges: (onMatched, onHintless) => {
      callbacks.matched = onMatched
      callbacks.hintless = onHintless
      return unsubscribe
    },
  })
  return {
    callbacks,
    dispose,
    events,
    fetchInteractionUpdates,
    fetchPage,
    state,
    unsubscribe,
  }
}

describe('createStreamingController', () => {
  const item = (postId: number) =>
    ({
      created_at_ms: 100,
      id: `p${postId}`,
      post_id: postId,
    }) as unknown as TimelineItem

  it('post_interactions のみ + changedPostIds 既知なら選択的リフレッシュを行う', async () => {
    const updated = item(7)
    const fetchInteractionUpdates = vi.fn(async () => ({
      durationMs: 2,
      items: [updated],
    }))
    const fetchPage = vi.fn(async () => ({ durationMs: 1, items: [] }))
    const h = setupController({ fetchInteractionUpdates, fetchPage })

    h.callbacks.matched?.(new Set(['post_interactions']), new Set([7]))

    await vi.waitFor(() => {
      expect(h.events).toContainEqual({
        items: [updated],
        type: 'INTERACTION_UPDATES_SUCCEEDED',
      })
    })
    expect(fetchInteractionUpdates).toHaveBeenCalledWith(new Set([7]), [])
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('post_interactions 以外を含む変更は通常フェッチにフォールバックする', async () => {
    const fetchInteractionUpdates = vi.fn(async () => null)
    const fetchPage = vi.fn(async () => ({ durationMs: 1, items: [] }))
    const h = setupController({ fetchInteractionUpdates, fetchPage })

    h.callbacks.matched?.(new Set(['post_interactions', 'posts']), new Set([7]))

    await vi.waitFor(() => {
      expect(fetchPage).toHaveBeenCalledTimes(1)
    })
    expect(fetchInteractionUpdates).not.toHaveBeenCalled()
  })

  it('選択的リフレッシュが null を返したら onMatched 経由で通常フェッチに再突入する', async () => {
    const fetchInteractionUpdates = vi.fn(async () => null)
    const fetchPage = vi.fn(async () => ({
      durationMs: 1,
      items: [] as TimelineItem[],
    }))
    const h = setupController({ fetchInteractionUpdates, fetchPage })

    h.callbacks.matched?.(new Set(['post_interactions']), new Set([7]))

    await vi.waitFor(() => {
      expect(fetchPage).toHaveBeenCalledTimes(1)
    })
    const options = fetchPage.mock.calls[0][0]
    expect(options?.sessionTag).toBe('streaming:cfg-1')
  })

  it('選択的リフレッシュのフォールバックは scrollback 中なら保留される', async () => {
    const fetchInteractionUpdates = vi.fn(async () => null)
    const fetchPage = vi.fn(async () => ({ durationMs: 1, items: [] }))
    const h = setupController({ fetchInteractionUpdates, fetchPage })
    h.state.isScrollbackRunning = true

    h.callbacks.matched?.(new Set(['post_interactions']), new Set([7]))

    await vi.waitFor(() => {
      expect(h.events).toContainEqual({
        changedTables: new Set(['post_interactions']),
        type: 'STREAMING_DEFERRED',
      })
    })
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('選択的リフレッシュが例外でも通常フェッチへフォールバックする', async () => {
    const fetchInteractionUpdates = vi.fn(async () => {
      throw new Error('refresh failed')
    })
    const fetchPage = vi.fn(async () => ({
      durationMs: 1,
      items: [] as TimelineItem[],
    }))
    const h = setupController({ fetchInteractionUpdates, fetchPage })

    h.callbacks.matched?.(new Set(['post_interactions']), new Set([7]))

    await vi.waitFor(() => {
      expect(fetchPage).toHaveBeenCalledTimes(1)
    })
  })

  it('scrollback 中の変更は STREAMING_DEFERRED で保留しフェッチしない', () => {
    const fetchPage = vi.fn(async () => ({ durationMs: 1, items: [] }))
    const h = setupController({
      fetchPage,
      state: { isScrollbackRunning: true },
    })

    h.callbacks.matched?.(new Set(['posts']), undefined)

    expect(h.events).toEqual([
      { changedTables: new Set(['posts']), type: 'STREAMING_DEFERRED' },
    ])
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('初期ロード完了前の変更は無視する', () => {
    const fetchPage = vi.fn(async () => ({ durationMs: 1, items: [] }))
    const h = setupController({ fetchPage, state: { initialized: false } })

    h.callbacks.matched?.(new Set(['posts']), undefined)

    expect(h.events).toEqual([])
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('dispose 後に解決した fetch は dispatch せず unsubscribe される', async () => {
    let resolveFetch: ((r: FetchPageResult) => void) | undefined
    const fetchPage = vi.fn(
      () =>
        new Promise<FetchPageResult>((resolve) => {
          resolveFetch = resolve
        }),
    )
    const h = setupController({ fetchPage })

    h.callbacks.matched?.(new Set(['posts']), undefined)
    expect(fetchPage).toHaveBeenCalledTimes(1)

    h.dispose()
    expect(h.unsubscribe).toHaveBeenCalled()

    resolveFetch?.({ durationMs: 1, items: [item(1)] })
    await Promise.resolve()

    expect(
      h.events.filter((e) => e.type === 'STREAMING_FETCH_SUCCEEDED'),
    ).toHaveLength(0)
  })

  it('hintless は世代を進め、飛行中の fetch 結果を破棄して全件再取得する', async () => {
    let resolveFirst: ((r: FetchPageResult) => void) | undefined
    const fetchPage = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<FetchPageResult>((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValue({ durationMs: 1, items: [item(9)] })
    const h = setupController({ fetchPage })

    h.callbacks.matched?.(new Set(['posts']), undefined)
    expect(fetchPage).toHaveBeenCalledTimes(1)

    h.callbacks.hintless?.()
    expect(h.events).toContainEqual({ type: 'HINTLESS_INVALIDATED' })
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage.mock.calls[1][0]).toEqual({
      limit: expect.any(Number),
    })

    resolveFirst?.({ durationMs: 1, items: [item(1)] })
    await vi.waitFor(() => {
      expect(h.events).toContainEqual({
        items: [item(9)],
        type: 'HINTLESS_REFETCH_SUCCEEDED',
      })
    })
    expect(
      h.events.filter((e) => e.type === 'STREAMING_FETCH_SUCCEEDED'),
    ).toHaveLength(0)
  })

  it('フェッチ実行中に到着した変更はコアレスされ追従フェッチで一度だけ処理する', async () => {
    let resolveFirst: ((r: FetchPageResult) => void) | undefined
    const fetchPage = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<FetchPageResult>((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValue({ durationMs: 1, items: [] })
    const h = setupController({ fetchPage })

    h.callbacks.matched?.(new Set(['posts']), undefined)
    expect(fetchPage).toHaveBeenCalledTimes(1)

    h.callbacks.matched?.(new Set(['notifications']), undefined)
    h.callbacks.matched?.(new Set(['post_media']), undefined)

    resolveFirst?.({ durationMs: 1, items: [] })
    await vi.waitFor(() => {
      expect(fetchPage).toHaveBeenCalledTimes(2)
    })
    const followUp = fetchPage.mock.calls[1][0]
    expect(followUp?.changedTables).toEqual(
      new Set(['notifications', 'post_media']),
    )
  })
})

describe('notification read refresh', () => {
  it('reexecutes the entire plan without a cursor and replaces the visible result', async () => {
    const h = setupController({
      state: {
        newestMs: 1000,
        sortedItems: [
          { created_at_ms: 100, id: '1' } as unknown as TimelineItem,
        ],
      },
    })
    h.callbacks.matched?.(
      new Set(['notifications', 'notification-read']),
      undefined,
    )
    await vi.waitFor(() =>
      expect(
        h.events.some(
          (event) => event.type === 'NOTIFICATION_READ_REFRESH_SUCCEEDED',
        ),
      ).toBe(true),
    )
    expect(h.fetchPage).toHaveBeenCalledWith(
      expect.objectContaining({ changedTables: undefined, cursor: undefined }),
    )
    h.dispose()
  })
  it('preserves the read reason across an in-flight normal fetch', async () => {
    let finish: ((result: FetchPageResult) => void) | undefined
    const fetchPage = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<FetchPageResult>((resolve) => {
            finish = resolve
          }),
      )
      .mockResolvedValue({ durationMs: 1, items: [] })
    const h = setupController({ fetchPage })
    h.callbacks.matched?.(new Set(['posts']), undefined)
    h.callbacks.matched?.(
      new Set(['notifications', 'notification-read']),
      undefined,
    )
    finish?.({ durationMs: 1, items: [] })
    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2))
    expect(fetchPage.mock.calls[1][0].changedTables).toBeUndefined()
    expect(
      h.events.some(
        (event) => event.type === 'NOTIFICATION_READ_REFRESH_SUCCEEDED',
      ),
    ).toBe(true)
    h.dispose()
  })
  it('keeps the read reason deferred during scrollback', () => {
    const h = setupController({ state: { isScrollbackRunning: true } })
    h.callbacks.matched?.(
      new Set(['notifications', 'notification-read']),
      undefined,
    )
    expect(h.events).toContainEqual({
      changedTables: new Set(['notifications', 'notification-read']),
      type: 'STREAMING_DEFERRED',
    })
    expect(h.fetchPage).not.toHaveBeenCalled()
    h.dispose()
  })
})
