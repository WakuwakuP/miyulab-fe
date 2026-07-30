import type { Entity } from 'megalodon'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getSqliteDb } = vi.hoisted(() => ({
  getSqliteDb: vi.fn(),
}))

vi.mock('util/db/sqlite/connection', () => ({
  getSqliteDb,
}))

import { exportDatabase, startPeriodicExport } from 'util/db/sqlite/dbExport'
import { syncFollows } from 'util/db/sqlite/followStore'

describe('database export', () => {
  const sendCommand = vi.fn()

  beforeEach(() => {
    getSqliteDb.mockReset()
    sendCommand.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('skips exports for an in-memory database', async () => {
    getSqliteDb.mockResolvedValue({
      persistence: 'memory',
      sendCommand,
    })

    await exportDatabase()

    expect(sendCommand).not.toHaveBeenCalled()
  })

  it('delegates OPFS exports to the worker', async () => {
    getSqliteDb.mockResolvedValue({
      persistence: 'opfs',
      sendCommand,
    })

    await exportDatabase()

    expect(sendCommand).toHaveBeenCalledWith({ type: 'exportDatabase' })
  })

  it('runs delayed and periodic exports until cleanup', async () => {
    vi.useFakeTimers()
    getSqliteDb.mockResolvedValue({
      persistence: 'opfs',
      sendCommand,
    })

    const stop = startPeriodicExport()

    await vi.advanceTimersByTimeAsync(119_999)
    expect(sendCommand).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(sendCommand).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(180_000)
    expect(sendCommand).toHaveBeenCalledTimes(2)

    stop()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(sendCommand).toHaveBeenCalledTimes(2)
  })

  it('logs periodic export failures without leaking a rejection', async () => {
    vi.useFakeTimers()
    getSqliteDb.mockRejectedValue(new Error('OPFS unavailable'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const stop = startPeriodicExport()
    await vi.advanceTimersByTimeAsync(120_000)

    expect(error).toHaveBeenCalledWith(
      'Failed to export database:',
      expect.objectContaining({ message: 'OPFS unavailable' }),
    )
    stop()
  })
})

describe('syncFollows', () => {
  const sendCommand = vi.fn()

  beforeEach(() => {
    getSqliteDb.mockReset()
    sendCommand.mockReset()
  })

  it('does not initialize SQLite for an empty follow list', async () => {
    await syncFollows([], 'https://example.com')

    expect(getSqliteDb).not.toHaveBeenCalled()
  })

  it('serializes accounts and delegates follow synchronization', async () => {
    const accounts = [
      { acct: 'alice', id: '1' },
      { acct: 'bob@example.net', id: '2' },
    ] as Entity.Account[]
    getSqliteDb.mockResolvedValue({ sendCommand })

    await syncFollows(accounts, 'https://example.com')

    expect(sendCommand).toHaveBeenCalledWith({
      accountsJson: accounts.map((account) => JSON.stringify(account)),
      backendUrl: 'https://example.com',
      type: 'syncFollows',
    })
  })
})
