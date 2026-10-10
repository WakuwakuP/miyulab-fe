import { expect, it } from 'vitest'
import { retainedTimelineAnchor } from './useVirtuosoTimelineLayout'

it('retains a visible row when filtered-out rows above it are removed', () => {
  expect(
    retainedTimelineAnchor(['a', 'b', 'c', 'd'], ['a', 'c', 'd'], 2),
  ).toEqual({ newIndex: 1, oldIndex: 2 })
})
it('anchors to the following retained row if the visible row disappears', () => {
  expect(retainedTimelineAnchor(['a', 'b', 'c', 'd'], ['a', 'd'], 2)).toEqual({
    newIndex: 1,
    oldIndex: 3,
  })
})
it('falls back to the previous retained row or returns no anchor', () => {
  expect(retainedTimelineAnchor(['a', 'b', 'c'], ['a'], 2)).toEqual({
    newIndex: 0,
    oldIndex: 0,
  })
  expect(retainedTimelineAnchor(['a'], [], 0)).toBeNull()
})
