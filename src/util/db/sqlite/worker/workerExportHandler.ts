/**
 * DB エクスポート（単一 sqlite3 ファイルとして OPFS に保存）
 *
 * エクスポート前に quick_check で健全性を検査し、破損した DB から
 * 正常なバックアップを上書きすることを防止する。
 */

import { isDatabaseHealthy } from './workerRecovery'
import { getDb, getSqlite3Module } from './workerState'

export async function handleExportDatabase(): Promise<void> {
  const db = getDb()
  const sqlite3Module = getSqlite3Module()

  if (!db || !sqlite3Module) {
    throw new Error('Database or sqlite3 module not initialized')
  }

  // 健全性チェック — 破損 DB のエクスポートを防止
  if (!isDatabaseHealthy(db)) {
    console.warn(
      'SQLite Worker: skipping export — database is corrupt, preserving existing backup',
    )
    return
  }

  // WAL を可能な範囲でフラッシュ（PASSIVE: ノンブロッキング）
  // TRUNCATE は書き込みロックを取得するため、大量データ時に長時間ブロックする。
  // PASSIVE は進行中の読み書きをブロックせず、可能なページのみチェックポイントする。
  db.exec('PRAGMA wal_checkpoint(PASSIVE);')

  // DB をシリアライズ
  const bytes: Uint8Array = sqlite3Module.capi.sqlite3_js_db_export(db)
  // 新しい ArrayBuffer にコピー（TypeScript 型互換性対策）
  const copy = new Uint8Array(bytes)

  // OPFS ルートに書き込み
  const root = await navigator.storage.getDirectory()
  const fileHandle = await root.getFileHandle('miyulab-fe-backup.sqlite3', {
    create: true,
  })
  const writable = await fileHandle.createWritable()
  await writable.write(copy.buffer as ArrayBuffer)
  await writable.close()

  console.info(
    `SQLite Worker: exported database (${(bytes.byteLength / 1024).toFixed(1)} KB) to OPFS`,
  )
}
