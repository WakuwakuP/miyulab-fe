import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSqliteDb, isTimelineQueueSaturated } = vi.hoisted(() => ({
  getSqliteDb: vi.fn(),
  isTimelineQueueSaturated: vi.fn(),
}))

vi.mock('util/db/sqlite/connection', () => ({
  getSqliteDb,
}))

vi.mock('util/db/dbQueue', () => ({
  isTimelineQueueSaturated,
}))

import {
  __CLEANUP_CONSTANTS,
  __resetCleanupStateForTest,
  startPeriodicCleanup,
} from 'util/db/sqlite/cleanup'

function installHandle(
  sendCommand: ReturnType<typeof vi.fn> = vi
    .fn()
    .mockResolvedValue({ hasMore: false }),
): ReturnType<typeof vi.fn> {
  getSqliteDb.mockResolvedValue({
    execAsync: vi.fn().mockResolvedValue([[0, 0, 0]]),
    sendCommand,
  })
  return sendCommand
}

describe('cleanup scheduling', () => {
  const stops: (() => void)[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-30T00:00:00.000Z'))
    vi.clearAllMocks()
    __resetCleanupStateForTest()
    isTimelineQueueSaturated.mockReturnValue(false)
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    for (const stop of stops.splice(0)) stop()
    __resetCleanupStateForTest()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function start(): () => void {
    const stop = startPeriodicCleanup()
    stops.push(stop)
    return stop
  }

  it('waits for the initial delay and then uses the periodic interval', async () => {
    const sendCommand = installHandle()
    start()

    await vi.advanceTimersByTimeAsync(__CLEANUP_CONSTANTS.INITIAL_DELAY_MS - 1)
    expect(sendCommand).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(sendCommand).toHaveBeenCalledWith(
      {
        mode: 'periodic',
        targetRatio: __CLEANUP_CONSTANTS.EMERGENCY_TARGET_RATIO,
        type: 'enforceMaxLength',
      },
      { kind: 'priority' },
    )

    await vi.advanceTimersByTimeAsync(__CLEANUP_CONSTANTS.PERIODIC_INTERVAL_MS)
    expect(sendCommand).toHaveBeenCalledTimes(2)
  })

  it('retries failures twice, then waits for the next full period', async () => {
    let attempt = 0
    const sendCommand = vi.fn().mockImplementation(async () => {
      attempt++
      if (attempt <= __CLEANUP_CONSTANTS.MAX_CONSECUTIVE_FAILURES) {
        throw new Error(`failure ${attempt}`)
      }
      return { hasMore: false }
    })
    installHandle(sendCommand)
    start()

    await vi.advanceTimersByTimeAsync(__CLEANUP_CONSTANTS.INITIAL_DELAY_MS)
    expect(sendCommand).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(__CLEANUP_CONSTANTS.RETRY_DELAY_MS)
    expect(sendCommand).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(__CLEANUP_CONSTANTS.RETRY_DELAY_MS)
    expect(sendCommand).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(
      __CLEANUP_CONSTANTS.PERIODIC_INTERVAL_MS - 1,
    )
    expect(sendCommand).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(sendCommand).toHaveBeenCalledTimes(4)
  })

  it('cancels the periodic timer when stopped', async () => {
    const sendCommand = installHandle()
    const stop = start()

    stop()
    await vi.advanceTimersByTimeAsync(
      __CLEANUP_CONSTANTS.INITIAL_DELAY_MS +
        __CLEANUP_CONSTANTS.PERIODIC_INTERVAL_MS,
    )

    expect(sendCommand).not.toHaveBeenCalled()
  })

  it('triggers emergency cleanup after sustained post-grace saturation', async () => {
    const sendCommand = installHandle()
    isTimelineQueueSaturated.mockReturnValue(true)
    start()

    await vi.advanceTimersByTimeAsync(__CLEANUP_CONSTANTS.INITIAL_GRACE_MS - 1)
    expect(sendCommand).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(sendCommand).toHaveBeenCalledWith(
      {
        mode: 'emergency',
        targetRatio: __CLEANUP_CONSTANTS.EMERGENCY_TARGET_RATIO,
        type: 'enforceMaxLength',
      },
      { kind: 'priority' },
    )
  })

  it('requires a new sustained interval after saturation clears', async () => {
    const sendCommand = installHandle()
    isTimelineQueueSaturated.mockReturnValue(true)
    start()

    await vi.advanceTimersByTimeAsync(3_000)
    isTimelineQueueSaturated.mockReturnValue(false)
    await vi.advanceTimersByTimeAsync(1_000)
    isTimelineQueueSaturated.mockReturnValue(true)
    await vi.advanceTimersByTimeAsync(
      __CLEANUP_CONSTANTS.INITIAL_GRACE_MS - 4_001,
    )
    expect(sendCommand).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(sendCommand).toHaveBeenCalledTimes(1)
  })

  it('does not overlap emergency cleanup while one is running', async () => {
    let resolveEmergency: ((value: { hasMore: boolean }) => void) | undefined
    const sendCommand = vi.fn(
      () =>
        new Promise<{ hasMore: boolean }>((resolve) => {
          resolveEmergency = resolve
        }),
    )
    installHandle(sendCommand)
    isTimelineQueueSaturated.mockReturnValue(true)
    start()

    await vi.advanceTimersByTimeAsync(__CLEANUP_CONSTANTS.INITIAL_GRACE_MS)
    expect(sendCommand).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(
      __CLEANUP_CONSTANTS.SATURATION_DURATION_MS * 3,
    )
    expect(sendCommand).toHaveBeenCalledTimes(1)

    resolveEmergency?.({ hasMore: false })
    await Promise.resolve()
  })

  it('honors the emergency cooldown before firing again', async () => {
    const sendCommand = installHandle()
    isTimelineQueueSaturated.mockReturnValue(true)
    start()

    await vi.advanceTimersByTimeAsync(__CLEANUP_CONSTANTS.INITIAL_GRACE_MS)
    expect(sendCommand).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(
      __CLEANUP_CONSTANTS.EMERGENCY_COOLDOWN_MS - 1,
    )
    expect(sendCommand).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(sendCommand).toHaveBeenCalledTimes(2)
  })

  it('shares one saturation watcher until the final owner stops', () => {
    installHandle()
    const firstStop = start()
    const secondStop = start()

    expect(vi.getTimerCount()).toBe(3)
    firstStop()
    expect(vi.getTimerCount()).toBe(2)
    firstStop()
    expect(vi.getTimerCount()).toBe(2)
    secondStop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
