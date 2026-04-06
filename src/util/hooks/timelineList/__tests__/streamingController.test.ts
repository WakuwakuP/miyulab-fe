import type { ChangeHint } from 'util/db/sqlite/connection'
import { describe, expect, it } from 'vitest'

import { CURSOR_MARGIN_MS } from '../itemHelpers'
import {
  aggregateChangedTables,
  buildStreamingCursor,
} from '../streamingHelpers'

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
