import type { ChangeHint } from 'util/db/sqlite/connection'
import { describe, expect, it } from 'vitest'

import { hintsMatchTimeline } from '../hintMatching'

describe('hintsMatchTimeline', () => {
  const configTimelineTypes = ['home', 'public']
  const targetBackendUrls = ['https://example.com', 'https://other.com']

  it('timelineType と backendUrl が一致すれば true', () => {
    const hints: ChangeHint[] = [
      { backendUrl: 'https://example.com', timelineType: 'home' },
    ]
    expect(
      hintsMatchTimeline(hints, configTimelineTypes, targetBackendUrls, false),
    ).toBe(true)
  })

  it('timelineType が一致しなければ false', () => {
    const hints: ChangeHint[] = [
      { backendUrl: 'https://example.com', timelineType: 'notification' },
    ]
    expect(
      hintsMatchTimeline(hints, configTimelineTypes, targetBackendUrls, false),
    ).toBe(false)
  })

  it('backendUrl が一致しなければ false', () => {
    const hints: ChangeHint[] = [
      { backendUrl: 'https://unknown.com', timelineType: 'home' },
    ]
    expect(
      hintsMatchTimeline(hints, configTimelineTypes, targetBackendUrls, false),
    ).toBe(false)
  })

  it('lookup の場合は timelineType をスキップする', () => {
    const hints: ChangeHint[] = [
      { backendUrl: 'https://example.com', timelineType: 'notification' },
    ]
    expect(
      hintsMatchTimeline(hints, configTimelineTypes, targetBackendUrls, true),
    ).toBe(true)
  })

  it('hint に timelineType がなければ timelineType チェックをスキップ', () => {
    const hints: ChangeHint[] = [{ backendUrl: 'https://example.com' }]
    expect(
      hintsMatchTimeline(hints, configTimelineTypes, targetBackendUrls, false),
    ).toBe(true)
  })

  it('hint に backendUrl がなければ backendUrl チェックをスキップ', () => {
    const hints: ChangeHint[] = [{ timelineType: 'home' }]
    expect(
      hintsMatchTimeline(hints, configTimelineTypes, targetBackendUrls, false),
    ).toBe(true)
  })

  it('空のヒント配列は false', () => {
    expect(
      hintsMatchTimeline([], configTimelineTypes, targetBackendUrls, false),
    ).toBe(false)
  })

  it('複数ヒントで1つでもマッチすれば true', () => {
    const hints: ChangeHint[] = [
      { backendUrl: 'https://unknown.com', timelineType: 'notification' },
      { backendUrl: 'https://example.com', timelineType: 'home' },
    ]
    expect(
      hintsMatchTimeline(hints, configTimelineTypes, targetBackendUrls, false),
    ).toBe(true)
  })
})
