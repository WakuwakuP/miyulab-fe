/**
 * SQLite Wasm 初期化モジュール
 *
 * OPFS (Origin Private File System) を利用して永続化する。
 * OPFS が利用できない環境（SharedArrayBuffer 非対応）では
 * メモリDB にフォールバックする。
 */

import type {
  Database,
  OpfsDatabase,
  Sqlite3Static,
} from '@sqlite.org/sqlite-wasm'

let dbPromise: Promise<DbHandle> | null = null

/**
 * 公開するDB操作ハンドル
 *
 * sqlite3 モジュール全体と、開いたデータベースハンドルを返す。
 */
export type DbHandle = {
  db: Database | OpfsDatabase
  sqlite3: Sqlite3Static
}

/**
 * SQLite をシングルトンで初期化する。
 */
export async function getDb(): Promise<DbHandle> {
  if (dbPromise) return dbPromise
  dbPromise = initDb()
  return dbPromise
}

async function initDb(): Promise<DbHandle> {
  // Dynamic import to avoid SSR issues (sqlite-wasm is browser-only)
  const initSqlite = (await import('@sqlite.org/sqlite-wasm')).default

  const sqlite3: Sqlite3Static = await initSqlite()

  let db: DbHandle['db']

  try {
    // OPFS で永続化を試みる
    db = new sqlite3.oo1.OpfsDb('/miyulab-fe.sqlite3', 'c')
    console.info('SQLite: using OPFS persistence')
  } catch {
    // フォールバック: メモリDB
    db = new sqlite3.oo1.DB(':memory:', 'c')
    console.warn('SQLite: OPFS not available, using in-memory database')
  }

  // WAL モード有効化（パフォーマンス向上）
  db.exec('PRAGMA journal_mode=WAL;')
  db.exec('PRAGMA synchronous=NORMAL;')
  db.exec('PRAGMA foreign_keys = ON;')

  return { db, sqlite3 }
}
