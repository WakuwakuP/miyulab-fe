/**
 * SQLite OPFS 初期化ロジック
 *
 * OPFS SAH Pool VFS → 通常 OPFS → インメモリ DB のフォールバックチェーンで初期化する。
 * 初期化後に PRAGMA quick_check で破損を検出し、必要に応じてバックアップから復元する。
 */

import { loadSqliteWasmInitializer } from '../sqliteWasmLoader'
import type { RecoveryResult } from './workerRecovery'
import { setDb, setSqlite3Module } from './workerState'

export type InitResult = {
  persistence: 'opfs' | 'memory'
  recovered?: 'restored' | 'reset'
}

// biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm types are not exact
type Sqlite3Module = any

function applyDatabasePragmas(db: Sqlite3Module): void {
  db.exec('PRAGMA journal_mode=WAL;')
  db.exec('PRAGMA synchronous=NORMAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA cache_size = -8000;') // 8MB（デフォルト2MB→8MB）
  db.exec('PRAGMA temp_store = MEMORY;') // 一時テーブルをメモリに配置
}

async function openPersistentDatabase(
  sqlite3: Sqlite3Module,
): Promise<{ db: Sqlite3Module; persistence: 'opfs' | 'memory' }> {
  try {
    const poolVfs = await sqlite3.installOpfsSAHPoolVfs({
      directory: '/miyulab-fe',
      name: 'opfs-sahpool',
    })
    const db = new poolVfs.OpfsSAHPoolDb('/miyulab-fe.sqlite3')
    console.info('SQLite Worker: using OPFS SAH Pool persistence')
    return { db, persistence: 'opfs' }
  } catch (e1) {
    console.debug(
      'SQLite Worker: OPFS SAH Pool unavailable, trying standard OPFS',
      e1,
    )
    try {
      const db = new sqlite3.oo1.OpfsDb('/miyulab-fe.sqlite3', 'c')
      console.info('SQLite Worker: using OPFS persistence')
      return { db, persistence: 'opfs' }
    } catch (e2) {
      console.warn(
        'SQLite Worker: OPFS not available, using in-memory database.',
        e2,
      )
      const db = new sqlite3.oo1.DB(':memory:', 'c')
      return { db, persistence: 'memory' }
    }
  }
}

function tryCloseDb(db: Sqlite3Module): void {
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
  sqlite3: Sqlite3Module,
  previousDb?: Sqlite3Module,
): Promise<{
  db: Sqlite3Module
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
  db: Sqlite3Module,
  sqlite3: Sqlite3Module,
  persistence: 'opfs' | 'memory',
): Promise<{
  db: Sqlite3Module
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
    console.error(
      'SQLite Worker: recovery failed, falling back to in-memory',
    )
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
