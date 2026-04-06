import {
  type ChangeHint,
  notifyChange,
  subscribe,
} from 'util/db/sqlite/connection'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('ChangeHint changedTables', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('changedTables を含むヒントがリスナーにそのまま渡される', () => {
    const listener = vi.fn()
    const unsub = subscribe('posts', listener)

    notifyChange('posts', {
      changedTables: ['posts', 'timeline_entries'],
      timelineType: 'home',
    })
    vi.advanceTimersByTime(80)

    expect(listener).toHaveBeenCalledOnce()
    const hints: ChangeHint[] = listener.mock.calls[0][0]
    expect(hints).toHaveLength(1)
    expect(hints[0].changedTables).toEqual(['posts', 'timeline_entries'])
    expect(hints[0].timelineType).toBe('home')

    unsub()
  })

  it('debounce 中に複数の notifyChange が呼ばれた場合、各ヒントの changedTables が個別に保持される', () => {
    const listener = vi.fn()
    const unsub = subscribe('posts', listener)

    notifyChange('posts', {
      changedTables: ['posts', 'timeline_entries'],
      timelineType: 'home',
    })
    notifyChange('posts', {
      changedTables: ['posts', 'post_interactions'],
      timelineType: 'local',
    })
    vi.advanceTimersByTime(80)

    expect(listener).toHaveBeenCalledOnce()
    const hints: ChangeHint[] = listener.mock.calls[0][0]
    expect(hints).toHaveLength(2)
    expect(hints[0].changedTables).toEqual(['posts', 'timeline_entries'])
    expect(hints[1].changedTables).toEqual(['posts', 'post_interactions'])

    unsub()
  })

  it('hintless 変更がある場合は空配列が渡される（既存動作の維持）', () => {
    const listener = vi.fn()
    const unsub = subscribe('posts', listener)

    notifyChange('posts', {
      changedTables: ['posts'],
      timelineType: 'home',
    })
    notifyChange('posts') // hintless
    vi.advanceTimersByTime(80)

    expect(listener).toHaveBeenCalledOnce()
    const hints: ChangeHint[] = listener.mock.calls[0][0]
    expect(hints).toEqual([])

    unsub()
  })

  it('changedTables はオプショナル（後方互換性）', () => {
    const listener = vi.fn()
    const unsub = subscribe('posts', listener)

    notifyChange('posts', { timelineType: 'home' })
    vi.advanceTimersByTime(80)

    expect(listener).toHaveBeenCalledOnce()
    const hints: ChangeHint[] = listener.mock.calls[0][0]
    expect(hints).toHaveLength(1)
    expect(hints[0].changedTables).toBeUndefined()
    expect(hints[0].timelineType).toBe('home')

    unsub()
  })

  it('changedTables 付きと changedTables なしのヒントが混在しても正しく蓄積される', () => {
    const listener = vi.fn()
    const unsub = subscribe('posts', listener)

    notifyChange('posts', {
      changedTables: ['posts', 'timeline_entries'],
      timelineType: 'home',
    })
    notifyChange('posts', { timelineType: 'local' })
    vi.advanceTimersByTime(80)

    expect(listener).toHaveBeenCalledOnce()
    const hints: ChangeHint[] = listener.mock.calls[0][0]
    expect(hints).toHaveLength(2)
    expect(hints[0].changedTables).toEqual(['posts', 'timeline_entries'])
    expect(hints[1].changedTables).toBeUndefined()

    unsub()
  })
})
