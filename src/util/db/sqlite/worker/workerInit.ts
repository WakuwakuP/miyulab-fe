/**
 * SQLite OPFS 初期化ロジック
 *
 * OPFS SAH Pool VFS → 通常 OPFS → インメモリ DB のフォールバックチェーンで初期化する。
 * 初期化後に PRAGMA quick_check で破損を検出し、必要に応じてバックアップから復元する。
 */

// biome-ignore-all lint/suspicious/noExplicitAny: sqlite-wasm types are not exact
import { loadSqliteWasmInitializer } from '../sqliteWasmLoader'
import type { RecoveryResult } from './workerRecovery'
import { setDb, setSqlite3Module } from './workerState'

export type InitResult = {
  persistence: 'opfs' | 'memory'
  recovered?: 'restored' | 'reset'
}

function applyDatabasePragmas(db: any): void {
  db.exec('PRAGMA journal_mode=WAL;')
  db.exec('PRAGMA synchronous=NORMAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA cache_size = -8000;') // 8MB（デフォルト2MB→8MB）
  db.exec('PRAGMA temp_store = MEMORY;') // 一時テーブルをメモリに配置
  logDatabaseFootprint(db)
}

function readPragmaNumber(db: any, pragma: string): number | null {
  try {
    const rows = db.exec(`PRAGMA ${pragma};`, { returnValue: 'resultRows' })
    const value = rows?.[0]?.[0]
    return typeof value === 'number' ? value : null
  } catch (error) {
    console.debug(`SQLite Worker: could not read PRAGMA ${pragma}`, error)
    return null
  }
}

function logDatabaseFootprint(db: any): void {
  const pageCount = readPragmaNumber(db, 'page_count')
  const pageSize = readPragmaNumber(db, 'page_size')
  const freelistCount = readPragmaNumber(db, 'freelist_count')
  if (pageCount == null || pageSize == null) return

  const bytes = pageCount * pageSize
  const freeBytes = (freelistCount ?? 0) * pageSize
  const mib = (value: number) => (value / (1024 * 1024)).toFixed(1)
  console.info(
    `SQLite Worker: database is ${mib(bytes)} MiB (${pageCount} pages, free ${mib(freeBytes)} MiB)`,
  )
}

async function openPersistentDatabase(
  sqlite3: any,
): Promise<{ db: any; persistence: 'opfs' | 'memory' }> {
  try {
    const poolStartedAt = performance.now()
    const poolVfs = await sqlite3.installOpfsSAHPoolVfs({
      directory: '/miyulab-fe',
      name: 'opfs-sahpool',
    })
    const capacity =
      typeof poolVfs.getCapacity === 'function' ? poolVfs.getCapacity() : null
    const fileCount =
      typeof poolVfs.getFileCount === 'function' ? poolVfs.getFileCount() : null
    console.info(
      `SQLite Worker: OPFS SAH Pool acquired in ${Math.round(performance.now() - poolStartedAt)}ms` +
        (capacity == null
          ? ''
          : ` (capacity=${capacity}, files=${fileCount ?? 'unknown'})`),
    )
    const db = new poolVfs.OpfsSAHPoolDb('/miyulab-fe.sqlite3')
    console.info('SQLite Worker: using OPFS SAH Pool persistence')
    return { db, persistence: 'opfs' }
  } catch (error_) {
    console.debug(
      'SQLite Worker: OPFS SAH Pool unavailable, trying standard OPFS',
      error_,
    )
    try {
      const db = new sqlite3.oo1.OpfsDb('/miyulab-fe.sqlite3', 'c')
      console.info('SQLite Worker: using OPFS persistence')
      return { db, persistence: 'opfs' }
    } catch (error_) {
      console.warn(
        'SQLite Worker: OPFS not available, using in-memory database.',
        error_,
      )
      const db = new sqlite3.oo1.DB(':memory:', 'c')
      return { db, persistence: 'memory' }
    }
  }
}

function tryCloseDb(db: any): void {
  try {
    db.close()
  } catch (closeError) {
    console.debug(
      'SQLite Worker: ignore error closing database before fallback',
      closeError,
    )
  }
}

async function createInMemoryFallback(
  sqlite3: any,
  previousDb?: any,
): Promise<{
  db: any
  persistence: 'memory'
  recovered: 'reset'
}> {
  if (previousDb) {
    tryCloseDb(previousDb)
  }
  const db = new sqlite3.oo1.DB(':memory:', 'c')
  applyDatabasePragmas(db)
  const { ensureSchema } = await import('../schema')
  ensureSchema({ db })
  return { db, persistence: 'memory', recovered: 'reset' }
}

async function recoverOpfsDatabaseIfNeeded(
  db: any,
  sqlite3: any,
  persistence: 'opfs' | 'memory',
): Promise<{
  db: any
  persistence: 'opfs' | 'memory'
  recovered?: 'restored' | 'reset'
}> {
  if (persistence !== 'opfs') {
    return { db, persistence }
  }

  const { isDatabaseHealthy, recoverFromCorruption } = await import(
    './workerRecovery'
  )
  if (isDatabaseHealthy(db)) {
    return { db, persistence }
  }

  console.warn('SQLite Worker: database corruption detected at startup')
  const result: RecoveryResult = await recoverFromCorruption(db, sqlite3)
  if (result !== 'restored' && result !== 'reset') {
    console.error('SQLite Worker: recovery failed, falling back to in-memory')
    return createInMemoryFallback(sqlite3, db)
  }

  if (isDatabaseHealthy(db)) {
    return { db, persistence, recovered: result }
  }

  console.error(
    'SQLite Worker: recovery completed but DB still corrupt, falling back to in-memory',
  )
  return createInMemoryFallback(sqlite3, db)
}

export async function init(origin: string): Promise<InitResult> {
  // Turbopack が import.meta.url を無効なスキームに書き換えるため、
  // Worker 内の相対 URL 解決が失敗する。
  // メインスレッドから渡された origin を使い絶対 URL で WASM を取得する。
  const wasmUrl = `${origin}/sqlite3.wasm`
  const wasmResponse = await fetch(wasmUrl)
  const wasmBinary = await wasmResponse.arrayBuffer()

  const initSqlite = await loadSqliteWasmInitializer(origin)
  // @ts-expect-error sqlite3InitModule accepts moduleArg but types omit it
  const sqlite3 = await initSqlite({
    locateFile: (file: string) => `${origin}/${file}`,
    wasmBinary,
  })

  setSqlite3Module(sqlite3)

  const opened = await openPersistentDatabase(sqlite3)
  let { db, persistence } = opened

  applyDatabasePragmas(db)

  const { ensureSchema } = await import('../schema')
  ensureSchema({ db })

  const recoveredState = await recoverOpfsDatabaseIfNeeded(
    db,
    sqlite3,
    persistence,
  )
  db = recoveredState.db
  persistence = recoveredState.persistence

  setDb(db)

  return {
    persistence,
    recovered: recoveredState.recovered,
  }
}
