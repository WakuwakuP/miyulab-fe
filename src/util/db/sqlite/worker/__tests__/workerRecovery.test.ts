import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const schemaMocks = vi.hoisted(() => ({
  createFreshSchema: vi.fn(),
  dropAllTables: vi.fn(),
  ensureSchema: vi.fn(),
}))

vi.mock('util/db/sqlite/schema', () => schemaMocks)

import {
  isDatabaseHealthy,
  isSqliteCorruptError,
  recoverFromCorruption,
} from 'util/db/sqlite/worker/workerRecovery'

function mockDbHealth(healthy: boolean) {
  return {
    close: vi.fn(),
    exec: vi.fn((sql: string) => {
      if (sql === 'PRAGMA quick_check(1);') {
        return [[healthy ? 'ok' : 'corrupt']]
      }
      return undefined
    }),
  }
}

function mockDbConstructor(db: object) {
  return vi.fn(function MockDb() {
    return db
  })
}

function createSqlite3({
  backupDb = mockDbHealth(true),
  backupInit = { id: 'backup' },
  backupStepResult = 101,
  deserializeResult = 0,
  supportsDeserialize = true,
}: {
  backupDb?: ReturnType<typeof mockDbHealth>
  backupInit?: object | null
  backupStepResult?: number
  deserializeResult?: number
  supportsDeserialize?: boolean
} = {}) {
  const heap = new Uint8Array(64)
  const capi = {
    sqlite3_backup_finish: vi.fn(),
    sqlite3_backup_init: vi.fn().mockReturnValue(backupInit),
    sqlite3_backup_step: vi.fn().mockReturnValue(backupStepResult),
    sqlite3_deserialize: supportsDeserialize
      ? vi.fn().mockReturnValue(deserializeResult)
      : undefined,
  }

  return {
    capi,
    heap,
    oo1: { DB: mockDbConstructor(backupDb) },
    wasm: {
      alloc: vi.fn().mockReturnValue(7),
      heap8u: vi.fn().mockReturnValue(heap),
    },
  }
}

function stubBackupFile(bytes: number[]) {
  const arrayBuffer = Uint8Array.from(bytes).buffer
  const getFile = vi.fn().mockResolvedValue({
    arrayBuffer: vi.fn().mockResolvedValue(arrayBuffer),
  })
  const getFileHandle = vi.fn().mockResolvedValue({ getFile })
  const getDirectory = vi.fn().mockResolvedValue({ getFileHandle })
  vi.stubGlobal('navigator', { storage: { getDirectory } })

  return { getDirectory, getFile, getFileHandle }
}

describe('workerRecovery health and error detection', () => {
  it('accepts only an ok quick_check result', () => {
    const healthyDb = mockDbHealth(true)
    const unhealthyDb = mockDbHealth(false)

    expect(isDatabaseHealthy(healthyDb)).toBe(true)
    expect(isDatabaseHealthy(unhealthyDb)).toBe(false)
    expect(
      isDatabaseHealthy({ exec: vi.fn().mockReturnValue(undefined) }),
    ).toBe(false)
  })

  it('treats a quick_check exception as an unhealthy database', () => {
    const db = {
      exec: vi.fn(() => {
        throw new Error('cannot read page')
      }),
    }

    expect(isDatabaseHealthy(db)).toBe(false)
  })

  it.each([
    new Error('SQLITE_CORRUPT: damaged'),
    'database disk image is malformed',
    new Error('sqlite result code 11'),
  ])('recognizes SQLite corruption errors: %s', (error) => {
    expect(isSqliteCorruptError(error)).toBe(true)
  })

  it.each([
    new Error('SQLITE_BUSY'),
    'constraint failed',
    { message: 'SQLITE_CORRUPT' },
    null,
  ])('does not misclassify other values: %s', (error) => {
    expect(isSqliteCorruptError(error)).toBe(false)
  })
})

describe('recoverFromCorruption backup restore', () => {
  beforeEach(() => {
    schemaMocks.createFreshSchema.mockReset()
    schemaMocks.dropAllTables.mockReset()
    schemaMocks.ensureSchema.mockReset()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('restores a healthy OPFS backup and upgrades its schema', async () => {
    const backupDb = mockDbHealth(true)
    const db = mockDbHealth(true)
    const sqlite3 = createSqlite3({ backupDb })
    const backup = stubBackupFile([1, 2, 3, 4])

    await expect(recoverFromCorruption(db, sqlite3)).resolves.toBe('restored')

    expect(backup.getFileHandle).toHaveBeenCalledWith(
      'miyulab-fe-backup.sqlite3',
    )
    expect(sqlite3.oo1.DB).toHaveBeenCalledWith(':memory:', 'c')
    expect(sqlite3.wasm.alloc).toHaveBeenCalledWith(4)
    expect([...sqlite3.heap.slice(7, 11)]).toEqual([1, 2, 3, 4])
    expect(sqlite3.capi.sqlite3_deserialize).toHaveBeenCalledWith(
      backupDb,
      'main',
      7,
      4,
      4,
      3,
    )
    expect(sqlite3.capi.sqlite3_backup_init).toHaveBeenCalledWith(
      db,
      'main',
      backupDb,
      'main',
    )
    expect(sqlite3.capi.sqlite3_backup_step).toHaveBeenCalledWith(
      { id: 'backup' },
      -1,
    )
    expect(sqlite3.capi.sqlite3_backup_finish).toHaveBeenCalledWith({
      id: 'backup',
    })
    expect(backupDb.close).toHaveBeenCalledOnce()
    expect(schemaMocks.ensureSchema).toHaveBeenCalledWith({ db })
    expect(schemaMocks.dropAllTables).not.toHaveBeenCalled()
  })

  it('skips backup restore when deserialize is unavailable', async () => {
    const db = mockDbHealth(true)
    const sqlite3 = createSqlite3({ supportsDeserialize: false })

    await expect(recoverFromCorruption(db, sqlite3)).resolves.toBe('reset')

    expect(schemaMocks.dropAllTables).toHaveBeenCalledWith({ db })
    expect(schemaMocks.createFreshSchema).toHaveBeenCalledWith({ db })
    expect(db.exec.mock.calls.map(([sql]) => sql)).toEqual([
      'PRAGMA user_version = 0;',
      'BEGIN;',
      'PRAGMA user_version = 20007;',
      'COMMIT;',
      'VACUUM;',
    ])
  })

  it('resets when no OPFS backup file exists', async () => {
    const getFileHandle = vi.fn().mockRejectedValue(new Error('not found'))
    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: vi.fn().mockResolvedValue({ getFileHandle }),
      },
    })
    const db = mockDbHealth(true)
    const sqlite3 = createSqlite3()

    await expect(recoverFromCorruption(db, sqlite3)).resolves.toBe('reset')

    expect(getFileHandle).toHaveBeenCalledWith('miyulab-fe-backup.sqlite3')
    expect(sqlite3.wasm.alloc).not.toHaveBeenCalled()
  })

  it('resets when the OPFS backup file is empty', async () => {
    stubBackupFile([])
    const db = mockDbHealth(true)
    const sqlite3 = createSqlite3()

    await expect(recoverFromCorruption(db, sqlite3)).resolves.toBe('reset')

    expect(sqlite3.wasm.alloc).not.toHaveBeenCalled()
    expect(sqlite3.oo1.DB).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'deserialize fails',
      options: { deserializeResult: 1 },
    },
    {
      name: 'the backup is corrupt',
      options: { backupDb: mockDbHealth(false) },
    },
    {
      name: 'backup initialization fails',
      options: { backupInit: null },
    },
    {
      name: 'backup copying fails',
      options: { backupStepResult: 5 },
    },
  ])('resets when $name', async ({ options }) => {
    stubBackupFile([9, 8, 7])
    const db = mockDbHealth(true)
    const sqlite3 = createSqlite3(options)

    await expect(recoverFromCorruption(db, sqlite3)).resolves.toBe('reset')

    expect(schemaMocks.dropAllTables).toHaveBeenCalledWith({ db })
    expect(schemaMocks.ensureSchema).not.toHaveBeenCalled()
  })

  it('resets when the copied backup does not repair the destination', async () => {
    stubBackupFile([9, 8, 7])
    const db = mockDbHealth(false)
    const sqlite3 = createSqlite3()

    await expect(recoverFromCorruption(db, sqlite3)).resolves.toBe('reset')

    expect(sqlite3.capi.sqlite3_backup_finish).toHaveBeenCalledOnce()
    expect(schemaMocks.dropAllTables).toHaveBeenCalledWith({ db })
  })

  it('falls back to reset when reading the backup throws', async () => {
    const getDirectory = vi.fn().mockRejectedValue(new Error('OPFS failed'))
    vi.stubGlobal('navigator', { storage: { getDirectory } })
    const db = mockDbHealth(true)
    const sqlite3 = createSqlite3()

    await expect(recoverFromCorruption(db, sqlite3)).resolves.toBe('reset')

    expect(console.warn).toHaveBeenCalledWith(
      'SQLite Worker: backup restoration failed:',
      expect.any(Error),
    )
  })

  it('closes the temporary database when restore setup throws', async () => {
    stubBackupFile([1])
    const backupDb = mockDbHealth(true)
    const sqlite3 = createSqlite3({ backupDb })
    sqlite3.wasm.alloc.mockImplementation(() => {
      throw new Error('allocation failed')
    })
    const db = mockDbHealth(true)

    await expect(recoverFromCorruption(db, sqlite3)).resolves.toBe('reset')

    expect(backupDb.close).toHaveBeenCalledOnce()
  })
})

describe('recoverFromCorruption reset fallbacks', () => {
  beforeEach(() => {
    schemaMocks.createFreshSchema.mockReset()
    schemaMocks.dropAllTables.mockReset()
    schemaMocks.ensureSchema.mockReset()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('overwrites the database from a fresh memory database when VACUUM fails', async () => {
    const db = mockDbHealth(true)
    db.exec.mockImplementation((sql: string) => {
      if (sql === 'VACUUM;') {
        throw new Error('vacuum failed')
      }
      return undefined
    })
    const memoryDb = mockDbHealth(true)
    const sqlite3 = createSqlite3({
      backupDb: memoryDb,
      supportsDeserialize: false,
    })

    await expect(recoverFromCorruption(db, sqlite3)).resolves.toBe('reset')

    expect(memoryDb.exec.mock.calls.map(([sql]) => sql)).toEqual([
      'PRAGMA foreign_keys = ON;',
      'BEGIN;',
      'PRAGMA user_version = 20007;',
      'COMMIT;',
    ])
    expect(schemaMocks.createFreshSchema).toHaveBeenNthCalledWith(1, { db })
    expect(schemaMocks.createFreshSchema).toHaveBeenNthCalledWith(2, {
      db: memoryDb,
    })
    expect(sqlite3.capi.sqlite3_backup_init).toHaveBeenCalledWith(
      db,
      'main',
      memoryDb,
      'main',
    )
    expect(memoryDb.close).toHaveBeenCalledOnce()
  })

  it('reports failure when memory backup initialization fails', async () => {
    const db = mockDbHealth(true)
    db.exec.mockImplementation((sql: string) => {
      if (sql === 'VACUUM;') throw new Error('vacuum failed')
      return undefined
    })
    const memoryDb = mockDbHealth(true)
    const sqlite3 = createSqlite3({
      backupDb: memoryDb,
      backupInit: null,
      supportsDeserialize: false,
    })

    await expect(recoverFromCorruption(db, sqlite3)).resolves.toBe('failed')

    expect(memoryDb.close).toHaveBeenCalledOnce()
    expect(sqlite3.capi.sqlite3_backup_step).not.toHaveBeenCalled()
  })

  it('reports failure when memory backup copying fails', async () => {
    const db = mockDbHealth(true)
    db.exec.mockImplementation((sql: string) => {
      if (sql === 'VACUUM;') throw new Error('vacuum failed')
      return undefined
    })
    const memoryDb = mockDbHealth(true)
    const sqlite3 = createSqlite3({
      backupDb: memoryDb,
      backupStepResult: 10,
      supportsDeserialize: false,
    })

    await expect(recoverFromCorruption(db, sqlite3)).resolves.toBe('failed')

    expect(sqlite3.capi.sqlite3_backup_finish).toHaveBeenCalledOnce()
    expect(memoryDb.close).toHaveBeenCalledOnce()
  })

  it('rolls back a failed DROP/CREATE and uses the memory backup fallback', async () => {
    const db = mockDbHealth(true)
    schemaMocks.dropAllTables.mockImplementationOnce(() => {
      throw new Error('drop failed')
    })
    const memoryDb = mockDbHealth(true)
    const sqlite3 = createSqlite3({
      backupDb: memoryDb,
      supportsDeserialize: false,
    })

    await expect(recoverFromCorruption(db, sqlite3)).resolves.toBe('reset')

    expect(db.exec).toHaveBeenCalledWith('ROLLBACK;')
    expect(sqlite3.capi.sqlite3_backup_step).toHaveBeenCalledOnce()
  })

  it('reports failure when both schema reset paths throw', async () => {
    const db = mockDbHealth(true)
    db.exec.mockImplementation((sql: string) => {
      if (sql === 'ROLLBACK;') throw new Error('rollback failed')
      return undefined
    })
    schemaMocks.dropAllTables.mockImplementationOnce(() => {
      throw new Error('drop failed')
    })
    schemaMocks.createFreshSchema.mockImplementationOnce(() => {
      throw new Error('memory schema failed')
    })
    const memoryDb = mockDbHealth(true)
    memoryDb.close.mockImplementation(() => {
      throw new Error('close failed')
    })
    const sqlite3 = createSqlite3({
      backupDb: memoryDb,
      supportsDeserialize: false,
    })

    await expect(recoverFromCorruption(db, sqlite3)).resolves.toBe('failed')

    expect(db.exec).toHaveBeenCalledWith('ROLLBACK;')
    expect(console.error).toHaveBeenCalledWith(
      'SQLite Worker: backup-based reset failed:',
      expect.any(Error),
    )
  })
})
