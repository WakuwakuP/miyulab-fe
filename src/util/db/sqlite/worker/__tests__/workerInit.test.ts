import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureSchema: vi.fn(),
  isDatabaseHealthy: vi.fn(),
  loadSqliteWasmInitializer: vi.fn(),
  recoverFromCorruption: vi.fn(),
  setDb: vi.fn(),
  setSqlite3Module: vi.fn(),
}))

vi.mock('util/db/sqlite/sqliteWasmLoader', () => ({
  loadSqliteWasmInitializer: mocks.loadSqliteWasmInitializer,
}))

vi.mock('util/db/sqlite/schema', () => ({
  ensureSchema: mocks.ensureSchema,
}))

vi.mock('util/db/sqlite/worker/workerRecovery', () => ({
  isDatabaseHealthy: mocks.isDatabaseHealthy,
  recoverFromCorruption: mocks.recoverFromCorruption,
}))

vi.mock('util/db/sqlite/worker/workerState', () => ({
  setDb: mocks.setDb,
  setSqlite3Module: mocks.setSqlite3Module,
}))

import { init } from 'util/db/sqlite/worker/workerInit'

function mockDbConstructor(db: object) {
  return vi.fn(function MockDb() {
    return db
  })
}

function createDb() {
  return {
    close: vi.fn(),
    exec: vi.fn(),
  }
}

function createSqlite3({
  memoryDb = createDb(),
  opfsDb = createDb(),
  opfsError,
  sahDb = createDb(),
  sahError,
}: {
  memoryDb?: ReturnType<typeof createDb>
  opfsDb?: ReturnType<typeof createDb>
  opfsError?: Error
  sahDb?: ReturnType<typeof createDb>
  sahError?: Error
} = {}) {
  const OpfsSAHPoolDb = mockDbConstructor(sahDb)
  const installOpfsSAHPoolVfs = sahError
    ? vi.fn().mockRejectedValue(sahError)
    : vi.fn().mockResolvedValue({ OpfsSAHPoolDb })
  const OpfsDb = opfsError
    ? vi.fn(function OpfsDb() {
        throw opfsError
      })
    : mockDbConstructor(opfsDb)

  return {
    DB: mockDbConstructor(memoryDb),
    installOpfsSAHPoolVfs,
    memoryDb,
    OpfsDb,
    OpfsSAHPoolDb,
    opfsDb,
    sahDb,
    sqlite3: {
      installOpfsSAHPoolVfs,
      oo1: {
        DB: mockDbConstructor(memoryDb),
        OpfsDb,
      },
    },
  }
}

function expectPragmas(db: ReturnType<typeof createDb>) {
  expect(db.exec.mock.calls.map(([sql]) => sql)).toEqual([
    'PRAGMA journal_mode=WAL;',
    'PRAGMA synchronous=NORMAL;',
    'PRAGMA foreign_keys = ON;',
    'PRAGMA cache_size = -8000;',
    'PRAGMA temp_store = MEMORY;',
  ])
}

describe('workerInit', () => {
  const origin = 'https://app.example'
  let wasmBinary: ArrayBuffer
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetAllMocks()
    wasmBinary = new ArrayBuffer(16)
    fetchMock = vi.fn().mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(wasmBinary),
    })
    vi.stubGlobal('fetch', fetchMock)
    mocks.isDatabaseHealthy.mockReturnValue(true)
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('loads WASM and opens an OPFS SAH Pool database', async () => {
    const setup = createSqlite3()
    const sqliteInitializer = vi.fn().mockResolvedValue(setup.sqlite3)
    mocks.loadSqliteWasmInitializer.mockResolvedValue(sqliteInitializer)

    await expect(init(origin)).resolves.toEqual({ persistence: 'opfs' })

    expect(fetchMock).toHaveBeenCalledWith(`${origin}/sqlite3.wasm`)
    expect(mocks.loadSqliteWasmInitializer).toHaveBeenCalledWith(origin)
    const moduleOptions = sqliteInitializer.mock.calls[0][0]
    expect(moduleOptions.wasmBinary).toBe(wasmBinary)
    expect(moduleOptions.locateFile('sqlite3.wasm')).toBe(
      `${origin}/sqlite3.wasm`,
    )
    expect(setup.installOpfsSAHPoolVfs).toHaveBeenCalledWith({
      directory: '/miyulab-fe',
      name: 'opfs-sahpool',
    })
    expect(setup.OpfsSAHPoolDb).toHaveBeenCalledWith('/miyulab-fe.sqlite3')
    expectPragmas(setup.sahDb)
    expect(mocks.ensureSchema).toHaveBeenCalledWith({ db: setup.sahDb })
    expect(mocks.isDatabaseHealthy).toHaveBeenCalledWith(setup.sahDb)
    expect(mocks.setSqlite3Module).toHaveBeenCalledWith(setup.sqlite3)
    expect(mocks.setDb).toHaveBeenCalledWith(setup.sahDb)
  })

  it('falls back to standard OPFS when the SAH Pool is unavailable', async () => {
    const setup = createSqlite3({
      sahError: new Error('SAH unavailable'),
    })
    const sqliteInitializer = vi.fn().mockResolvedValue(setup.sqlite3)
    mocks.loadSqliteWasmInitializer.mockResolvedValue(sqliteInitializer)

    await expect(init(origin)).resolves.toEqual({ persistence: 'opfs' })

    expect(setup.OpfsDb).toHaveBeenCalledWith('/miyulab-fe.sqlite3', 'c')
    expectPragmas(setup.opfsDb)
    expect(mocks.setDb).toHaveBeenCalledWith(setup.opfsDb)
  })

  it('falls back to memory when neither OPFS implementation is available', async () => {
    const setup = createSqlite3({
      opfsError: new Error('OPFS unavailable'),
      sahError: new Error('SAH unavailable'),
    })
    const sqliteInitializer = vi.fn().mockResolvedValue(setup.sqlite3)
    mocks.loadSqliteWasmInitializer.mockResolvedValue(sqliteInitializer)

    await expect(init(origin)).resolves.toEqual({ persistence: 'memory' })

    expect(setup.sqlite3.oo1.DB).toHaveBeenCalledWith(':memory:', 'c')
    expectPragmas(setup.memoryDb)
    expect(mocks.ensureSchema).toHaveBeenCalledWith({ db: setup.memoryDb })
    expect(mocks.isDatabaseHealthy).not.toHaveBeenCalled()
    expect(mocks.recoverFromCorruption).not.toHaveBeenCalled()
    expect(mocks.setDb).toHaveBeenCalledWith(setup.memoryDb)
  })

  it.each(['restored', 'reset'] as const)(
    'keeps OPFS after a successful %s recovery',
    async (recoveryResult) => {
      const setup = createSqlite3()
      const sqliteInitializer = vi.fn().mockResolvedValue(setup.sqlite3)
      mocks.loadSqliteWasmInitializer.mockResolvedValue(sqliteInitializer)
      mocks.isDatabaseHealthy
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true)
      mocks.recoverFromCorruption.mockResolvedValue(recoveryResult)

      await expect(init(origin)).resolves.toEqual({
        persistence: 'opfs',
        recovered: recoveryResult,
      })

      expect(mocks.recoverFromCorruption).toHaveBeenCalledWith(
        setup.sahDb,
        setup.sqlite3,
      )
      expect(mocks.isDatabaseHealthy).toHaveBeenCalledTimes(2)
      expect(setup.sahDb.close).not.toHaveBeenCalled()
      expect(mocks.setDb).toHaveBeenCalledWith(setup.sahDb)
    },
  )

  it('uses a fresh memory database when recovery fails', async () => {
    const memoryDb = createDb()
    const setup = createSqlite3({ memoryDb })
    const sqliteInitializer = vi.fn().mockResolvedValue(setup.sqlite3)
    mocks.loadSqliteWasmInitializer.mockResolvedValue(sqliteInitializer)
    mocks.isDatabaseHealthy.mockReturnValue(false)
    mocks.recoverFromCorruption.mockResolvedValue('failed')

    await expect(init(origin)).resolves.toEqual({
      persistence: 'memory',
      recovered: 'reset',
    })

    expect(setup.sahDb.close).toHaveBeenCalledOnce()
    expect(setup.sqlite3.oo1.DB).toHaveBeenCalledWith(':memory:', 'c')
    expectPragmas(memoryDb)
    expect(mocks.ensureSchema).toHaveBeenNthCalledWith(1, { db: setup.sahDb })
    expect(mocks.ensureSchema).toHaveBeenNthCalledWith(2, { db: memoryDb })
    expect(mocks.setDb).toHaveBeenCalledWith(memoryDb)
  })

  it('uses memory when recovery reports success but health remains bad', async () => {
    const memoryDb = createDb()
    const setup = createSqlite3({ memoryDb })
    const sqliteInitializer = vi.fn().mockResolvedValue(setup.sqlite3)
    mocks.loadSqliteWasmInitializer.mockResolvedValue(sqliteInitializer)
    mocks.isDatabaseHealthy.mockReturnValue(false)
    mocks.recoverFromCorruption.mockResolvedValue('restored')

    await expect(init(origin)).resolves.toEqual({
      persistence: 'memory',
      recovered: 'reset',
    })

    expect(mocks.isDatabaseHealthy).toHaveBeenCalledTimes(2)
    expect(setup.sahDb.close).toHaveBeenCalledOnce()
    expect(mocks.setDb).toHaveBeenCalledWith(memoryDb)
  })

  it('continues with memory fallback when closing corrupt OPFS throws', async () => {
    const memoryDb = createDb()
    const sahDb = createDb()
    sahDb.close.mockImplementation(() => {
      throw new Error('close failed')
    })
    const setup = createSqlite3({ memoryDb, sahDb })
    const sqliteInitializer = vi.fn().mockResolvedValue(setup.sqlite3)
    mocks.loadSqliteWasmInitializer.mockResolvedValue(sqliteInitializer)
    mocks.isDatabaseHealthy.mockReturnValue(false)
    mocks.recoverFromCorruption.mockResolvedValue('failed')

    await expect(init(origin)).resolves.toEqual({
      persistence: 'memory',
      recovered: 'reset',
    })

    expect(console.debug).toHaveBeenCalledWith(
      'SQLite Worker: ignore error closing database before fallback',
      expect.any(Error),
    )
    expect(mocks.setDb).toHaveBeenCalledWith(memoryDb)
  })
})
