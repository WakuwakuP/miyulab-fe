import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function loadConnection(saturated: boolean) {
  const getDb = vi.fn().mockResolvedValue({ persistence: 'memory' })
  vi.doMock('util/db/dbQueue', () => ({
    isTimelineQueueSaturated: vi.fn().mockReturnValue(saturated),
  }))
  vi.doMock('util/db/sqlite/initSqlite', () => ({ getDb }))
  const connection = await import('util/db/sqlite/connection')
  return { connection, getDb }
}

describe('SQLite connection branches', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.doUnmock('util/db/dbQueue')
    vi.doUnmock('util/db/sqlite/initSqlite')
  })

  it('uses the longer debounce while the timeline queue is saturated', async () => {
    const { connection } = await loadConnection(true)
    const listener = vi.fn()
    const unsubscribe = connection.subscribe('posts', listener)

    connection.notifyChange('posts', { timelineType: 'home' })
    await vi.advanceTimersByTimeAsync(299)
    expect(listener).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(listener).toHaveBeenCalledWith([{ timelineType: 'home' }])

    unsubscribe()
  })

  it('flushes notifications safely when a table has no listeners', async () => {
    const { connection } = await loadConnection(false)

    connection.notifyChange('posts', { timelineType: 'home' })

    await vi.advanceTimersByTimeAsync(80)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('isolates listener failures and continues notifying later listeners', async () => {
    const { connection } = await loadConnection(false)
    const failure = new Error('listener failed')
    const failingListener = vi.fn(() => {
      throw failure
    })
    const healthyListener = vi.fn()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unsubscribeFailing = connection.subscribe('posts', failingListener)
    const unsubscribeHealthy = connection.subscribe('posts', healthyListener)

    connection.notifyChange('posts')
    await vi.advanceTimersByTimeAsync(80)

    expect(error).toHaveBeenCalledWith('Change listener error:', failure)
    expect(healthyListener).toHaveBeenCalledWith([])
    unsubscribeFailing()
    unsubscribeHealthy()
  })

  it('initializes SQLite once and reuses the same ready promise', async () => {
    const { connection, getDb } = await loadConnection(false)

    const first = connection.getSqliteDb()
    const second = connection.getSqliteDb()

    expect(second).toBe(first)
    await expect(first).resolves.toEqual({ persistence: 'memory' })
    expect(getDb).toHaveBeenCalledOnce()
    expect(getDb).toHaveBeenCalledWith(connection.notifyChange)
  })
})
