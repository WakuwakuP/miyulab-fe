import type { TimelineItem } from 'util/hooks/useTimelineDataSource'
import { describe, expect, it } from 'vitest'

import {
  itemKey,
  itemTimestamp,
  mergeItemsIntoMap,
  sortItemsDesc,
} from '../itemHelpers'

describe('itemKey', () => {
  it('post_id があれば p:{id} を返す', () => {
    const item = {
      created_at_ms: 100,
      id: 'x',
      post_id: 42,
    } as unknown as TimelineItem
    expect(itemKey(item)).toBe('p:42')
  })

  it('notification_id があれば n:{id} を返す', () => {
    const item = {
      created_at_ms: 200,
      id: 'y',
      notification_id: 7,
    } as unknown as TimelineItem
    expect(itemKey(item)).toBe('n:7')
  })

  it('それ以外は u:{id} を返す', () => {
    const item = { created_at_ms: 300, id: 'abc' } as unknown as TimelineItem
    expect(itemKey(item)).toBe('u:abc')
  })
})

describe('itemTimestamp', () => {
  it('created_at_ms があればそのまま返す', () => {
    const item = { created_at_ms: 1000, id: '1' } as unknown as TimelineItem
    expect(itemTimestamp(item)).toBe(1000)
  })

  it('created_at (ISO文字列) からパースする', () => {
    const item = {
      created_at: '2024-01-01T00:00:00.000Z',
      id: '1',
    } as unknown as TimelineItem
    expect(itemTimestamp(item)).toBe(
      new Date('2024-01-01T00:00:00.000Z').getTime(),
    )
  })

  it('どちらもなければ 0 を返す', () => {
    const item = { id: '1' } as unknown as TimelineItem
    expect(itemTimestamp(item)).toBe(0)
  })
})

describe('mergeItemsIntoMap', () => {
  it('空配列なら false を返す', () => {
    const map = new Map()
    const cursors = { newestMs: 0, oldestMs: Number.MAX_SAFE_INTEGER }
    expect(mergeItemsIntoMap(map, [], cursors)).toBe(false)
  })

  it('新しいアイテムを追加して true を返す', () => {
    const map = new Map()
    const cursors = { newestMs: 0, oldestMs: Number.MAX_SAFE_INTEGER }
    const items = [
      { created_at_ms: 500, id: 'a', post_id: 1 },
      { created_at_ms: 1000, id: 'b', post_id: 2 },
    ] as unknown as TimelineItem[]
    const result = mergeItemsIntoMap(map, items, cursors)
    expect(result).toBe(true)
    expect(map.size).toBe(2)
    expect(cursors.newestMs).toBe(1000)
    expect(cursors.oldestMs).toBe(500)
  })

  it('既存アイテムを上書きする', () => {
    const map = new Map()
    const cursors = { newestMs: 0, oldestMs: Number.MAX_SAFE_INTEGER }
    const item1 = {
      content: 'old',
      created_at_ms: 500,
      id: 'a',
      post_id: 1,
    } as unknown as TimelineItem
    const item2 = {
      content: 'new',
      created_at_ms: 500,
      id: 'a',
      post_id: 1,
    } as unknown as TimelineItem
    mergeItemsIntoMap(map, [item1], cursors)
    mergeItemsIntoMap(map, [item2], cursors)
    expect(map.size).toBe(1)
    expect((map.get('p:1') as unknown as { content: string }).content).toBe(
      'new',
    )
  })
})

describe('sortItemsDesc', () => {
  it('created_at_ms の降順でソートする', () => {
    const items = [
      { created_at_ms: 100, id: 'a', post_id: 1 },
      { created_at_ms: 300, id: 'b', post_id: 2 },
      { created_at_ms: 200, id: 'c', post_id: 3 },
    ] as unknown as TimelineItem[]
    const sorted = sortItemsDesc(items)
    expect(sorted.map((i) => itemTimestamp(i))).toEqual([300, 200, 100])
  })

  it('元配列を変更しない', () => {
    const items = [
      { created_at_ms: 100, id: 'a', post_id: 1 },
      { created_at_ms: 300, id: 'b', post_id: 2 },
    ] as unknown as TimelineItem[]
    const original = [...items]
    sortItemsDesc(items)
    expect(items[0]).toBe(original[0])
    expect(items[1]).toBe(original[1])
  })
})
