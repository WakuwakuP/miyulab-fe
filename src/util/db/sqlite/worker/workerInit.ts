/**
 * SQLite OPFS 初期化ロジック
 *
 * OPFS SAH Pool VFS → 通常 OPFS → インメモリ DB のフォールバックチェーンで初期化する。
 * 初期化後に PRAGMA quick_check で破損を検出し、必要に応じてバックアップから復元する。
 */

import type { RecoveryResult } from './workerRecovery'
import { setDb, setSqlite3Module } from './workerState'

export type InitResult = {
  persistence: 'opfs' | 'memory'
  recovered?: 'restored' | 'reset'
}

export async function init(origin: string): Promise<InitResult> {
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

  // 破損検出 — OPFS 永続化の場合のみ検査（インメモリは破損しない）
  let recovered: 'restored' | 'reset' | undefined
  if (persistence === 'opfs') {
    const { isDatabaseHealthy, recoverFromCorruption } = await import(
      './workerRecovery'
    )
    if (!isDatabaseHealthy(db)) {
      console.warn('SQLite Worker: database corruption detected at startup')
      const result: RecoveryResult = await recoverFromCorruption(db, sqlite3)
      if (result === 'restored' || result === 'reset') {
        // リカバリ後に再検証 — VACUUM/backup で本当に破損が除去されたか確認
        if (isDatabaseHealthy(db)) {
          recovered = result
        } else {
          console.error(
            'SQLite Worker: recovery completed but DB still corrupt, falling back to in-memory',
          )
          try {
            db.close()
          } catch {
            /* ignore close error */
          }
          db = new sqlite3.oo1.DB(':memory:', 'c')
          persistence = 'memory'
          db.exec('PRAGMA journal_mode=WAL;')
          db.exec('PRAGMA synchronous=NORMAL;')
          db.exec('PRAGMA foreign_keys = ON;')
          db.exec('PRAGMA cache_size = -8000;')
          db.exec('PRAGMA temp_store = MEMORY;')
          ensureSchema({ db })
          recovered = 'reset'
        }
      } else {
        console.error(
          'SQLite Worker: recovery failed, falling back to in-memory',
        )
        try {
          db.close()
        } catch {
          /* ignore close error */
        }
        db = new sqlite3.oo1.DB(':memory:', 'c')
        persistence = 'memory'
        db.exec('PRAGMA journal_mode=WAL;')
        db.exec('PRAGMA synchronous=NORMAL;')
        db.exec('PRAGMA foreign_keys = ON;')
        db.exec('PRAGMA cache_size = -8000;')
        db.exec('PRAGMA temp_store = MEMORY;')
        ensureSchema({ db })
        recovered = 'reset'
      }
    }
  }

  setDb(db)

  return { persistence, recovered }
}
