import type { TimelineConfigV2 } from 'types/types'
import type {
  FetchPageResult,
  TimelineItem,
} from 'util/hooks/useTimelineDataSource'
import { expect, it, vi } from 'vitest'
import { createInitialState } from '../reducer'
import { useTimelineScrollbackController } from '../useTimelineScrollbackController'

vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useCallback: (callback: unknown) => callback,
}))

it('discards pending scrollback after a timeline reset', async () => {
  const page = Promise.withResolvers<FetchPageResult>()
  const dispatch = vi.fn()
  const exhaustedResourcesRef = { current: new Map() }
  const stateRef = { current: createInitialState() }
  const loadOlder = useTimelineScrollbackController({
    apps: [],
    config: { type: 'home' } as TimelineConfigV2,
    dispatch,
    exhaustedResourcesRef,
    fetchInteractionUpdates: vi.fn(),
    fetchPage: () => page.promise,
    includeNotifications: false,
    recordDuration: vi.fn(),
    stateRef,
    targetBackendUrls: [],
  })

  const pending = loadOlder()
  expect(dispatch.mock.calls).toEqual([[{ type: 'SCROLLBACK_STARTED' }]])
  exhaustedResourcesRef.current = new Map()
  stateRef.current = createInitialState()
  dispatch.mockClear()
  page.resolve({
    durationMs: 0,
    items: [{ appIndex: 0, id: 'old-post' } as TimelineItem],
  })
  await pending
  expect(dispatch).not.toHaveBeenCalled()
})
