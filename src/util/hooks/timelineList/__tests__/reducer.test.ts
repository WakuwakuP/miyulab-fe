import type { TimelineItem } from 'util/hooks/useTimelineDataSource'
import { describe, expect, it } from 'vitest'

import {
  createInitialState,
  type TimelineListEvent,
  type TimelineListState,
  timelineListReducer,
} from '../reducer'

// --------------- ヘルパー ---------------

function makeStatus(id: string, createdAtMs: number): TimelineItem {
  return {
    content: `post ${id}`,
    created_at_ms: createdAtMs,
    id,
    post_id: Number(id),
  } as unknown as TimelineItem
}

function dispatch(
  state: TimelineListState,
  ...events: TimelineListEvent[]
): TimelineListState {
  return events.reduce(timelineListReducer, state)
}

// --------------- テスト ---------------

describe('createInitialState', () => {
  it('デフォルト値が正しい', () => {
    const s = createInitialState()
    expect(s.sortedItems).toEqual([])
    expect(s.itemMap.size).toBe(0)
    expect(s.newestMs).toBe(0)
    expect(s.oldestMs).toBe(Number.MAX_SAFE_INTEGER)
    expect(s.initialized).toBe(false)
    expect(s.isScrollbackRunning).toBe(false)
    expect(s.hasMoreOlder).toBe(true)
    expect(s.deferredStreaming).toBe(false)
    expect(s.exhaustedResources.size).toBe(0)
  })
})

describe('INITIAL_FETCH_SUCCEEDED', () => {
  it('アイテムがマージされ initialized=true になる', () => {
    const s0 = createInitialState()
    const items = [makeStatus('1', 100), makeStatus('2', 200)]
    const s1 = dispatch(s0, { items, type: 'INITIAL_FETCH_SUCCEEDED' })

    expect(s1.initialized).toBe(true)
    expect(s1.itemMap.size).toBe(2)
    expect(s1.sortedItems).toHaveLength(2)
  })

  it('ソート済みアイテムが降順になる', () => {
    const s0 = createInitialState()
    const items = [
      makeStatus('1', 100),
      makeStatus('2', 300),
      makeStatus('3', 200),
    ]
    const s1 = dispatch(s0, { items, type: 'INITIAL_FETCH_SUCCEEDED' })

    const timestamps = s1.sortedItems.map((i) => (i as any).created_at_ms)
    expect(timestamps).toEqual([300, 200, 100])
  })

  it('newestMs と oldestMs が更新される', () => {
    const s0 = createInitialState()
    const items = [makeStatus('1', 100), makeStatus('2', 300)]
    const s1 = dispatch(s0, { items, type: 'INITIAL_FETCH_SUCCEEDED' })

    expect(s1.newestMs).toBe(300)
    expect(s1.oldestMs).toBe(100)
  })
})

describe('INITIAL_FETCH_EMPTY', () => {
  it('hasMoreOlder=false, initialized=true になる', () => {
    const s0 = createInitialState()
    const s1 = dispatch(s0, { type: 'INITIAL_FETCH_EMPTY' })

    expect(s1.hasMoreOlder).toBe(false)
    expect(s1.initialized).toBe(true)
    expect(s1.sortedItems).toEqual([])
  })
})

describe('STREAMING_FETCH_SUCCEEDED', () => {
  it('新しいアイテムが追加される', () => {
    const s0 = createInitialState()
    const initial = [makeStatus('1', 100)]
    const streaming = [makeStatus('2', 200)]
    const s1 = dispatch(
      s0,
      { items: initial, type: 'INITIAL_FETCH_SUCCEEDED' },
      { items: streaming, type: 'STREAMING_FETCH_SUCCEEDED' },
    )

    expect(s1.itemMap.size).toBe(2)
    expect(s1.newestMs).toBe(200)
  })

  it('重複アイテムは上書きされる（dedup）', () => {
    const s0 = createInitialState()
    const item1 = makeStatus('1', 100)
    const item2 = {
      ...makeStatus('1', 100),
      content: 'updated',
    } as unknown as TimelineItem
    const s1 = dispatch(
      s0,
      { items: [item1], type: 'INITIAL_FETCH_SUCCEEDED' },
      { items: [item2], type: 'STREAMING_FETCH_SUCCEEDED' },
    )

    expect(s1.itemMap.size).toBe(1)
    expect((s1.itemMap.get('p:1') as any).content).toBe('updated')
  })

  it('空配列は状態を変更しない', () => {
    const s0 = createInitialState()
    const items = [makeStatus('1', 100)]
    const s1 = dispatch(s0, { items, type: 'INITIAL_FETCH_SUCCEEDED' })
    const s2 = dispatch(s1, { items: [], type: 'STREAMING_FETCH_SUCCEEDED' })

    expect(s2).toBe(s1)
  })
})

describe('STREAMING_DEFERRED', () => {
  it('deferredStreaming=true になる', () => {
    const s0 = createInitialState()
    const s1 = dispatch(s0, { type: 'STREAMING_DEFERRED' })

    expect(s1.deferredStreaming).toBe(true)
  })
})

describe('DEFERRED_STREAMING_FLUSH_SUCCEEDED', () => {
  it('アイテムがマージされ deferredStreaming=false になる', () => {
    const s0 = createInitialState()
    const items = [makeStatus('1', 100)]
    const s1 = dispatch(
      s0,
      { type: 'STREAMING_DEFERRED' },
      { items, type: 'DEFERRED_STREAMING_FLUSH_SUCCEEDED' },
    )

    expect(s1.deferredStreaming).toBe(false)
    expect(s1.itemMap.size).toBe(1)
  })
})

describe('SCROLLBACK_STARTED', () => {
  it('isScrollbackRunning=true になる', () => {
    const s0 = createInitialState()
    const s1 = dispatch(s0, { type: 'SCROLLBACK_STARTED' })

    expect(s1.isScrollbackRunning).toBe(true)
  })
})

describe('SCROLLBACK_DB_SUCCEEDED', () => {
  it('古いアイテムが追加され oldestMs が更新される', () => {
    const s0 = createInitialState()
    const initial = [makeStatus('1', 500)]
    const older = [makeStatus('2', 100), makeStatus('3', 200)]
    const s1 = dispatch(
      s0,
      { items: initial, type: 'INITIAL_FETCH_SUCCEEDED' },
      { items: older, type: 'SCROLLBACK_DB_SUCCEEDED' },
    )

    expect(s1.itemMap.size).toBe(3)
    expect(s1.oldestMs).toBe(100)
    expect(s1.newestMs).toBe(500)
  })
})

describe('SCROLLBACK_COMPLETED', () => {
  it('isScrollbackRunning=false, hasMoreOlder が更新される', () => {
    const s0 = createInitialState()
    const s1 = dispatch(
      s0,
      { type: 'SCROLLBACK_STARTED' },
      { hasMoreOlder: false, type: 'SCROLLBACK_COMPLETED' },
    )

    expect(s1.isScrollbackRunning).toBe(false)
    expect(s1.hasMoreOlder).toBe(false)
  })

  it('deferredStreaming がリセットされる', () => {
    const s0 = createInitialState()
    const s1 = dispatch(
      s0,
      { type: 'STREAMING_DEFERRED' },
      { type: 'SCROLLBACK_STARTED' },
      { hasMoreOlder: true, type: 'SCROLLBACK_COMPLETED' },
    )

    expect(s1.deferredStreaming).toBe(false)
  })
})

describe('HINTLESS_INVALIDATED', () => {
  it('アイテムがクリアされカーソルがリセットされる', () => {
    const s0 = createInitialState()
    const items = [makeStatus('1', 100), makeStatus('2', 200)]
    const s1 = dispatch(
      s0,
      { items, type: 'INITIAL_FETCH_SUCCEEDED' },
      { type: 'HINTLESS_INVALIDATED' },
    )

    expect(s1.sortedItems).toEqual([])
    expect(s1.itemMap.size).toBe(0)
    expect(s1.newestMs).toBe(0)
    expect(s1.oldestMs).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('initialized は保持される', () => {
    const s0 = createInitialState()
    const items = [makeStatus('1', 100)]
    const s1 = dispatch(
      s0,
      { items, type: 'INITIAL_FETCH_SUCCEEDED' },
      { type: 'HINTLESS_INVALIDATED' },
    )

    expect(s1.initialized).toBe(true)
  })
})

describe('HINTLESS_REFETCH_SUCCEEDED', () => {
  it('新しいアイテムで再初期化される', () => {
    const s0 = createInitialState()
    const initial = [makeStatus('1', 100)]
    const refetch = [makeStatus('2', 200), makeStatus('3', 300)]
    const s1 = dispatch(
      s0,
      { items: initial, type: 'INITIAL_FETCH_SUCCEEDED' },
      { items: refetch, type: 'HINTLESS_REFETCH_SUCCEEDED' },
    )

    expect(s1.initialized).toBe(true)
    expect(s1.itemMap.size).toBe(2)
    expect(s1.sortedItems).toHaveLength(2)
    // 古いアイテムは含まれない
    expect(s1.itemMap.has('p:1')).toBe(false)
  })
})

describe('RESET', () => {
  it('createInitialState() に戻る', () => {
    const s0 = createInitialState()
    const items = [makeStatus('1', 100)]
    const s1 = dispatch(
      s0,
      { items, type: 'INITIAL_FETCH_SUCCEEDED' },
      { type: 'RESET' },
    )

    expect(s1.initialized).toBe(false)
    expect(s1.sortedItems).toEqual([])
    expect(s1.itemMap.size).toBe(0)
    expect(s1.newestMs).toBe(0)
    expect(s1.oldestMs).toBe(Number.MAX_SAFE_INTEGER)
    expect(s1.hasMoreOlder).toBe(true)
  })
})

describe('複合シナリオ', () => {
  it('初期→ストリーミング→スクロールバック', () => {
    const s0 = createInitialState()
    const s = dispatch(
      s0,
      { items: [makeStatus('2', 200)], type: 'INITIAL_FETCH_SUCCEEDED' },
      { items: [makeStatus('3', 300)], type: 'STREAMING_FETCH_SUCCEEDED' },
      { type: 'SCROLLBACK_STARTED' },
      { items: [makeStatus('1', 100)], type: 'SCROLLBACK_DB_SUCCEEDED' },
      { hasMoreOlder: true, type: 'SCROLLBACK_COMPLETED' },
    )

    expect(s.initialized).toBe(true)
    expect(s.itemMap.size).toBe(3)
    expect(s.newestMs).toBe(300)
    expect(s.oldestMs).toBe(100)
    expect(s.isScrollbackRunning).toBe(false)
    expect(s.hasMoreOlder).toBe(true)

    const timestamps = s.sortedItems.map((i) => (i as any).created_at_ms)
    expect(timestamps).toEqual([300, 200, 100])
  })

  it('scrollback 中の deferred → flush', () => {
    const s0 = createInitialState()
    const s = dispatch(
      s0,
      { items: [makeStatus('1', 100)], type: 'INITIAL_FETCH_SUCCEEDED' },
      { type: 'SCROLLBACK_STARTED' },
      { type: 'STREAMING_DEFERRED' },
      { items: [makeStatus('0', 50)], type: 'SCROLLBACK_DB_SUCCEEDED' },
      { hasMoreOlder: true, type: 'SCROLLBACK_COMPLETED' },
      {
        items: [makeStatus('2', 200)],
        type: 'DEFERRED_STREAMING_FLUSH_SUCCEEDED',
      },
    )

    expect(s.deferredStreaming).toBe(false)
    expect(s.isScrollbackRunning).toBe(false)
    expect(s.itemMap.size).toBe(3)
    expect(s.newestMs).toBe(200)
    expect(s.oldestMs).toBe(50)
  })

  it('scrollback中に複数回 STREAMING_DEFERRED が来ても deferredStreaming は true のまま', () => {
    const s0 = createInitialState()
    const s = dispatch(
      s0,
      { items: [makeStatus('1', 100)], type: 'INITIAL_FETCH_SUCCEEDED' },
      { type: 'SCROLLBACK_STARTED' },
      { type: 'STREAMING_DEFERRED' },
      { type: 'STREAMING_DEFERRED' },
      { type: 'STREAMING_DEFERRED' },
    )

    expect(s.deferredStreaming).toBe(true)
    expect(s.isScrollbackRunning).toBe(true)
  })

  it('boundary: created_at_ms = 0 のアイテムが正しく処理される', () => {
    const s0 = createInitialState()
    const s = dispatch(s0, {
      items: [makeStatus('1', 0)],
      type: 'INITIAL_FETCH_SUCCEEDED',
    })

    expect(s.itemMap.size).toBe(1)
    expect(s.newestMs).toBe(0)
    expect(s.oldestMs).toBe(0)
    expect(s.sortedItems).toHaveLength(1)
  })

  it('hintless invalidate 後に streaming が正常に動作する', () => {
    const s0 = createInitialState()
    const s = dispatch(
      s0,
      { items: [makeStatus('1', 100)], type: 'INITIAL_FETCH_SUCCEEDED' },
      { type: 'HINTLESS_INVALIDATED' },
      {
        items: [makeStatus('2', 200), makeStatus('3', 300)],
        type: 'HINTLESS_REFETCH_SUCCEEDED',
      },
      {
        items: [makeStatus('4', 400)],
        type: 'STREAMING_FETCH_SUCCEEDED',
      },
    )

    expect(s.initialized).toBe(true)
    expect(s.itemMap.size).toBe(3)
    expect(s.newestMs).toBe(400)
    expect(s.oldestMs).toBe(200)
    // 古い item '1' は含まれない
    expect(s.itemMap.has('p:1')).toBe(false)
    expect(s.itemMap.has('p:4')).toBe(true)
  })

  it('フルシナリオ: 初期取得→streaming→scrollback→deferred→flush→2回目scrollback→streaming再開', () => {
    const s0 = createInitialState()
    const s = dispatch(
      s0,
      // 初期取得
      {
        items: [makeStatus('5', 500), makeStatus('4', 400)],
        type: 'INITIAL_FETCH_SUCCEEDED',
      },
      // streaming で新しいアイテム到着
      { items: [makeStatus('6', 600)], type: 'STREAMING_FETCH_SUCCEEDED' },
      // 1回目 scrollback
      { type: 'SCROLLBACK_STARTED' },
      // scrollback 中に streaming 通知
      { type: 'STREAMING_DEFERRED' },
      // scrollback DB 成功
      { items: [makeStatus('3', 300)], type: 'SCROLLBACK_DB_SUCCEEDED' },
      // scrollback 完了
      { hasMoreOlder: true, type: 'SCROLLBACK_COMPLETED' },
      // deferred streaming flush
      {
        items: [makeStatus('7', 700)],
        type: 'DEFERRED_STREAMING_FLUSH_SUCCEEDED',
      },
      // 2回目 scrollback
      { type: 'SCROLLBACK_STARTED' },
      {
        items: [makeStatus('2', 200), makeStatus('1', 100)],
        type: 'SCROLLBACK_DB_SUCCEEDED',
      },
      { hasMoreOlder: false, type: 'SCROLLBACK_COMPLETED' },
      // streaming 再開
      { items: [makeStatus('8', 800)], type: 'STREAMING_FETCH_SUCCEEDED' },
    )

    expect(s.initialized).toBe(true)
    expect(s.itemMap.size).toBe(8)
    expect(s.newestMs).toBe(800)
    expect(s.oldestMs).toBe(100)
    expect(s.isScrollbackRunning).toBe(false)
    expect(s.hasMoreOlder).toBe(false)
    expect(s.deferredStreaming).toBe(false)

    const timestamps = s.sortedItems.map((i) => (i as any).created_at_ms)
    expect(timestamps).toEqual([800, 700, 600, 500, 400, 300, 200, 100])
  })
})
