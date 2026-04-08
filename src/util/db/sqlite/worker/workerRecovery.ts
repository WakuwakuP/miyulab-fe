/**
 * SQLite Worker: 破損データベースの検出とリカバリ
 *
 * SQLITE_CORRUPT (rc=11) が検出された場合、以下の順序でリカバリを試みる:
 * 1. OPFS バックアップからの復元 (sqlite3_deserialize → quick_check → sqlite3_backup API)
 * 2. 全テーブル DROP → 最新スキーマで再作成 → VACUUM でファイルを再構築
 * 3. VACUUM 失敗時はインメモリ空 DB から sqlite3_backup でページ全体を上書き
 */

import { createFreshSchema, dropAllTables } from '../schema'
import { encodeSemVer, LATEST_VERSION } from '../schema/version'

/** リカバリの結果 */
export type RecoveryResult = 'restored' | 'reset' | 'failed'

/**
 * PRAGMA quick_check(1) でデータベースの健全性を検査する。
 * 最初の B-tree ページのみ検査するため非常に軽量。
 */
export function isDatabaseHealthy(
  // biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm types are not exact
  db: any,
): boolean {
  try {
    const rows = db.exec('PRAGMA quick_check(1);', {
      returnValue: 'resultRows',
    })
    return rows?.[0]?.[0] === 'ok'
  } catch {
    return false
  }
}

/**
 * エラーが SQLITE_CORRUPT かどうかを判定する
 */
export function isSqliteCorruptError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  return (
    msg.includes('SQLITE_CORRUPT') ||
    msg.includes('database disk image is malformed') ||
    msg.includes('result code 11')
  )
}

/**
 * 破損した DB のリカバリを試行する。
 *
 * 1. OPFS バックアップ (miyulab-fe-backup.sqlite3) から復元を試みる
 * 2. 失敗した場合、全テーブル DROP → 最新スキーマで再作成にフォールバック
 *
 * @returns リカバリ方法
 */
export async function recoverFromCorruption(
  // biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm types are not exact
  db: any,
  // biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm module type
  sqlite3: any,
): Promise<RecoveryResult> {
  // Attempt 1: バックアップから復元
  try {
    const restored = await tryRestoreFromBackup(db, sqlite3)
    if (restored) {
      // 復元した DB のスキーマを最新化（マイグレーション適用）
      const { ensureSchema } = await import('../schema')
      ensureSchema({ db })
      console.info('SQLite Worker: database restored from backup')
      return 'restored'
    }
  } catch (e) {
    console.warn('SQLite Worker: backup restoration failed:', e)
  }

  // Attempt 2: 空の DB にリセット（VACUUM + backup fallback でファイル再構築）
  if (resetToEmpty(db, sqlite3)) {
    return 'reset'
  }

  return 'failed'
}

/**
 * OPFS バックアップからの復元を試みる。
 *
 * 1. OPFS ルートから miyulab-fe-backup.sqlite3 を読み込む
 * 2. インメモリ DB にデシリアライズして整合性を検証
 * 3. sqlite3_backup API で破損 DB のページを上書き
 * 4. 復元後の DB を再検証
 */
async function tryRestoreFromBackup(
  // biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm types are not exact
  db: any,
  // biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm module type
  sqlite3: any,
): Promise<boolean> {
  if (typeof sqlite3.capi.sqlite3_deserialize !== 'function') {
    console.info(
      'SQLite Worker: sqlite3_deserialize not available, skipping backup restore',
    )
    return false
  }

  // 1. OPFS からバックアップを読み込み
  const root = await navigator.storage.getDirectory()
  let fileHandle: FileSystemFileHandle
  try {
    fileHandle = await root.getFileHandle('miyulab-fe-backup.sqlite3')
  } catch {
    console.info('SQLite Worker: no backup file found')
    return false
  }

  const file = await fileHandle.getFile()
  const arrayBuffer = await file.arrayBuffer()
  const backupBytes = new Uint8Array(arrayBuffer)

  if (backupBytes.byteLength === 0) {
    console.info('SQLite Worker: backup file is empty')
    return false
  }

  console.info(
    `SQLite Worker: attempting restore from backup (${(backupBytes.byteLength / 1024).toFixed(1)} KB)`,
  )

  // 2. インメモリ DB にデシリアライズして整合性を検証
  const backupDb = new sqlite3.oo1.DB(':memory:', 'c')
  try {
    const pBuf = sqlite3.wasm.alloc(backupBytes.byteLength)
    sqlite3.wasm.heap8u().set(backupBytes, pBuf)

    const SQLITE_DESERIALIZE_FREEONCLOSE = 1
    const SQLITE_DESERIALIZE_RESIZEABLE = 2
    const rc = sqlite3.capi.sqlite3_deserialize(
      backupDb,
      'main',
      pBuf,
      backupBytes.byteLength,
      backupBytes.byteLength,
      SQLITE_DESERIALIZE_FREEONCLOSE | SQLITE_DESERIALIZE_RESIZEABLE,
    )

    if (rc !== 0) {
      console.warn(`SQLite Worker: backup deserialize failed (rc=${rc})`)
      backupDb.close()
      return false
    }

    if (!isDatabaseHealthy(backupDb)) {
      console.warn('SQLite Worker: backup file is also corrupt')
      backupDb.close()
      return false
    }

    // 3. sqlite3_backup API で破損 DB のページを上書き
    const pBackup = sqlite3.capi.sqlite3_backup_init(
      db,
      'main',
      backupDb,
      'main',
    )
    if (!pBackup) {
      console.warn('SQLite Worker: sqlite3_backup_init failed')
      backupDb.close()
      return false
    }

    const SQLITE_DONE = 101
    const stepRc = sqlite3.capi.sqlite3_backup_step(pBackup, -1)
    sqlite3.capi.sqlite3_backup_finish(pBackup)
    backupDb.close()

    if (stepRc !== SQLITE_DONE) {
      console.warn(`SQLite Worker: sqlite3_backup_step failed (rc=${stepRc})`)
      return false
    }

    // 4. 復元後の DB を検証
    if (!isDatabaseHealthy(db)) {
      console.warn('SQLite Worker: restored DB failed integrity check')
      return false
    }

    console.info(
      `SQLite Worker: successfully restored ${(backupBytes.byteLength / 1024).toFixed(1)} KB from backup`,
    )
    return true
  } catch (e) {
    try {
      backupDb.close()
    } catch {
      /* ignore close error */
    }
    throw e
  }
}

/**
 * 全テーブルを DROP → 最新スキーマで再作成 → VACUUM でファイルを再構築する。
 *
 * DROP+CREATE だけでは OPFS SAH Pool ファイルの free pages に残った破損データが
 * ページ再利用時に SQLITE_CORRUPT を引き起こす。VACUUM はファイル全体を再構築して
 * 破損 free pages を除去する。VACUUM が失敗した場合はインメモリ空 DB から
 * sqlite3_backup API でページ全体を上書きする。
 */
function resetToEmpty(
  // biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm types are not exact
  db: any,
  // biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm module type
  sqlite3: any,
): boolean {
  try {
    const handle = { db }
    db.exec('PRAGMA user_version = 0;')
    dropAllTables(handle)
    db.exec('BEGIN;')
    createFreshSchema(handle)
    db.exec(`PRAGMA user_version = ${encodeSemVer(LATEST_VERSION)};`)
    db.exec('COMMIT;')

    // VACUUM でファイル全体を再構築 — 破損 free pages を除去
    try {
      db.exec('VACUUM;')
      console.info(
        'SQLite Worker: database reset to empty schema (with VACUUM)',
      )
      return true
    } catch (vacuumError) {
      console.warn(
        'SQLite Worker: VACUUM failed after reset, trying backup-based reset:',
        vacuumError,
      )
      return resetViaBackupFromMemory(db, sqlite3)
    }
  } catch (e) {
    try {
      db.exec('ROLLBACK;')
    } catch {
      /* ignore rollback error */
    }
    console.warn(
      'SQLite Worker: DROP/CREATE reset failed, trying backup-based reset:',
      e,
    )
    return resetViaBackupFromMemory(db, sqlite3)
  }
}

/**
 * インメモリ空 DB を作成し、sqlite3_backup API で OPFS DB を完全に上書きする。
 * これにより破損ファイルの全ページ（free pages 含む）が新しいデータで置き換えられる。
 */
function resetViaBackupFromMemory(
  // biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm types are not exact
  db: any,
  // biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm module type
  sqlite3: any,
): boolean {
  const SQLITE_DONE = 101
  const memDb = new sqlite3.oo1.DB(':memory:', 'c')
  try {
    memDb.exec('PRAGMA foreign_keys = ON;')
    const handle = { db: memDb }
    memDb.exec('BEGIN;')
    createFreshSchema(handle)
    memDb.exec(`PRAGMA user_version = ${encodeSemVer(LATEST_VERSION)};`)
    memDb.exec('COMMIT;')

    const pBackup = sqlite3.capi.sqlite3_backup_init(db, 'main', memDb, 'main')
    if (!pBackup) {
      console.warn('SQLite Worker: sqlite3_backup_init for memory reset failed')
      memDb.close()
      return false
    }

    const rc = sqlite3.capi.sqlite3_backup_step(pBackup, -1)
    sqlite3.capi.sqlite3_backup_finish(pBackup)
    memDb.close()

    if (rc !== SQLITE_DONE) {
      console.warn(
        `SQLite Worker: sqlite3_backup_step for memory reset failed (rc=${rc})`,
      )
      return false
    }

    console.info('SQLite Worker: database reset via backup from memory')
    return true
  } catch (e) {
    try {
      memDb.close()
    } catch {
      /* ignore close error */
    }
    console.error('SQLite Worker: backup-based reset failed:', e)
    return false
  }
}
