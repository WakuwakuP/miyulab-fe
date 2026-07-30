import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { isDatabaseHealthy } = vi.hoisted(() => ({
  isDatabaseHealthy: vi.fn(),
}))

vi.mock('util/db/sqlite/worker/workerRecovery', () => ({
  isDatabaseHealthy,
}))

import { handleExportDatabase } from 'util/db/sqlite/worker/workerExportHandler'
import { setDb, setSqlite3Module } from 'util/db/sqlite/worker/workerState'

describe('handleExportDatabase', () => {
  beforeEach(() => {
    isDatabaseHealthy.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    setDb(null)
    setSqlite3Module(null)
  })

  it('rejects when the database or sqlite module is unavailable', async () => {
    setDb(null)
    setSqlite3Module({ capi: {} })
    await expect(handleExportDatabase()).rejects.toThrow(
      'Database or sqlite3 module not initialized',
    )

    setDb({ exec: vi.fn() })
    setSqlite3Module(null)
    await expect(handleExportDatabase()).rejects.toThrow(
      'Database or sqlite3 module not initialized',
    )
  })

  it('preserves the existing backup when the database is unhealthy', async () => {
    const db = { exec: vi.fn() }
    setDb(db)
    setSqlite3Module({ capi: {} })
    isDatabaseHealthy.mockReturnValue(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await handleExportDatabase()

    expect(db.exec).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      'SQLite Worker: skipping export — database is corrupt, preserving existing backup',
    )
  })

  it('checkpoints, copies, and writes a healthy database to OPFS', async () => {
    const db = { exec: vi.fn() }
    const bytes = new Uint8Array([1, 2, 3, 4])
    const sqlite3Module = {
      capi: { sqlite3_js_db_export: vi.fn().mockReturnValue(bytes) },
    }
    const write = vi.fn().mockResolvedValue(undefined)
    const close = vi.fn().mockResolvedValue(undefined)
    const createWritable = vi.fn().mockResolvedValue({ close, write })
    const getFileHandle = vi.fn().mockResolvedValue({ createWritable })
    const getDirectory = vi.fn().mockResolvedValue({ getFileHandle })
    vi.stubGlobal('navigator', { storage: { getDirectory } })
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    setDb(db)
    setSqlite3Module(sqlite3Module)
    isDatabaseHealthy.mockReturnValue(true)

    await handleExportDatabase()

    expect(db.exec).toHaveBeenCalledWith('PRAGMA wal_checkpoint(PASSIVE);')
    expect(sqlite3Module.capi.sqlite3_js_db_export).toHaveBeenCalledWith(db)
    expect(getFileHandle).toHaveBeenCalledWith('miyulab-fe-backup.sqlite3', {
      create: true,
    })
    expect(write).toHaveBeenCalledOnce()
    const copiedBytes = write.mock.calls[0][0] as Uint8Array
    expect(copiedBytes).toEqual(bytes)
    expect(copiedBytes).not.toBe(bytes)
    expect(close).toHaveBeenCalledOnce()
    expect(info).toHaveBeenCalledWith(
      'SQLite Worker: exported database (0.0 KB) to OPFS',
    )
  })
})
