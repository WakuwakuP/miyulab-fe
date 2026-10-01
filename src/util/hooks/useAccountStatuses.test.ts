import type { Entity } from 'megalodon'
import { describe, expect, it } from 'vitest'

import {
  mergeAccountStatusPage,
  updateAccountStatus,
} from './useAccountStatuses'

const status = (id: string, content = id) => ({ content, id }) as Entity.Status

describe('mergeAccountStatusPage', () => {
  it('appends unique posts in page order and preserves first occurrences', () => {
    const statuses = [status('4'), status('3')]
    const page = [
      status('3', 'overlap'),
      status('2'),
      status('2', 'duplicate'),
      status('1'),
    ]
    const originalStatuses = structuredClone(statuses)
    const originalPage = structuredClone(page)

    const result = mergeAccountStatusPage(statuses, page)

    expect(result).toEqual({
      hasMore: true,
      statuses: [statuses[0], statuses[1], page[1], page[3]],
    })
    expect(statuses).toEqual(originalStatuses)
    expect(page).toEqual(originalPage)
  })

  it('allows more pages after a short nonempty page, including initial load', () => {
    const page = [status('2')]

    expect(mergeAccountStatusPage([], page)).toEqual({
      hasMore: true,
      statuses: page,
    })
    expect(mergeAccountStatusPage([status('3')], page).hasMore).toBe(true)
  })

  it.each([
    { page: [] },
    { page: [status('3'), status('2')] },
    { page: [status('3')] },
  ])('stops when a page adds no new posts: %j', ({ page }) => {
    const statuses = [status('3'), status('2')]

    expect(mergeAccountStatusPage(statuses, page)).toEqual({
      hasMore: false,
      statuses,
    })
  })

  it('stops when the raw page cursor repeats the previous cursor', () => {
    const statuses = [status('3'), status('2')]
    const page = [status('1'), status('2')]

    expect(mergeAccountStatusPage(statuses, page)).toEqual({
      hasMore: false,
      statuses: [...statuses, page[0]],
    })
  })
})

describe('updateAccountStatus', () => {
  const updates: Partial<Entity.Status> = {
    bookmarked: true,
    emoji_reactions: [{ count: 1, me: true, name: '👍' }],
    favourited: true,
    poll: { id: 'poll', voted: true, votes_count: 1 } as Entity.Poll,
    reblogged: true,
  }

  it('keeps unrelated statuses unchanged', () => {
    const original = { ...status('3'), reblog: status('2') }

    expect(updateAccountStatus(original, '1', updates)).toBe(original)
  })

  it('updates a matching root without replacing unrelated fields', () => {
    const original = { ...status('3'), reblog: status('2') }

    expect(updateAccountStatus(original, '3', updates)).toEqual({
      ...original,
      ...updates,
    })
    expect(original).toEqual({ ...status('3'), reblog: status('2') })
  })

  it('updates interactions on a reblog and retains them across overlapping pages', () => {
    const original = { ...status('3'), reblog: status('2') }
    const updated = updateAccountStatus(original, '2', updates)

    expect(updated).toEqual({
      ...original,
      ...updates,
      reblog: { ...original.reblog, ...updates },
    })
    expect(original).toEqual({ ...status('3'), reblog: status('2') })
    expect(
      mergeAccountStatusPage([updated], [original, status('1')]).statuses[0],
    ).toBe(updated)
  })
})
