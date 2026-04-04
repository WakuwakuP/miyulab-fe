/**
 * SQLite OPFS 初期化ロジック
 *
 * OPFS SAH Pool VFS → 通常 OPFS → インメモリ DB のフォールバックチェーンで初期化する。
 */

import { setDb, setSqlite3Module } from './workerState'

export async function init(origin: string): Promise<'opfs' | 'memory'> {
  // Turbopack が import.meta.url を無効なスキームに書き換えるため、
  // Worker 内の相対 URL 解決が失敗する。
  // メインスレッドから渡された origin を使い絶対 URL で WASM を取得する。
  const wasmUrl = `${origin}/sqlite3.wasm`
  const wasmResponse = await fetch(wasmUrl)
  const wasmBinary = await wasmResponse.arrayBuffer()

  const initSqlite = (await import('@sqlite.org/sqlite-wasm')).default
  // @ts-expect-error sqlite3InitModule accepts moduleArg but types omit it
  const sqlite3 = await initSqlite({
    locateFile: (file: string) => `${origin}/${file}`,
    wasmBinary,
  })

  let persistence: 'opfs' | 'memory' = 'memory'
  setSqlite3Module(sqlite3)

  // biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm types are not exact
  let db: any

  // 1. OPFS SAH Pool VFS（最高パフォーマンス）
  try {
    const poolVfs = await sqlite3.installOpfsSAHPoolVfs({
      directory: '/miyulab-fe',
      name: 'opfs-sahpool',
    })
    db = new poolVfs.OpfsSAHPoolDb('/miyulab-fe.sqlite3')
    persistence = 'opfs'
    console.info('SQLite Worker: using OPFS SAH Pool persistence')
  } catch (_e1) {
    // 2. 通常の OPFS
    try {
      db = new sqlite3.oo1.OpfsDb('/miyulab-fe.sqlite3', 'c')
      persistence = 'opfs'
      console.info('SQLite Worker: using OPFS persistence')
    } catch (_e2) {
      // 3. インメモリ DB フォールバック
      db = new sqlite3.oo1.DB(':memory:', 'c')
      persistence = 'memory'
      console.warn(
        'SQLite Worker: OPFS not available, using in-memory database.',
      )
    }
  }

  // PRAGMA 設定
  db.exec('PRAGMA journal_mode=WAL;')
  db.exec('PRAGMA synchronous=NORMAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA cache_size = -8000;') // 8MB（デフォルト2MB→8MB）
  db.exec('PRAGMA temp_store = MEMORY;') // 一時テーブルをメモリに配置

  // スキーマ初期化
  const { ensureSchema } = await import('../schema')
  ensureSchema({ db })

  setDb(db)

  return persistence
}
