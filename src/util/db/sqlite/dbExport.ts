/**
 * SQLite データベース定期エクスポート
 *
 * OPFS SAH Pool VFS のデータを単一の sqlite3 ファイルとして
 * OPFS ルートに定期的に保存する。
 *
 * Worker モードでは sendCommand で Worker に委譲し、
 * Worker 内で sqlite3_js_db_export → OPFS 書き込みを行う。
 */

import { getSqliteDb } from './connection'

/** エクスポート間隔: 5 分 */
const EXPORT_INTERVAL_MS = 5 * 60 * 1000

/**
 * データベースを単一 sqlite3 ファイルとして OPFS にエクスポートする。
 */
export async function exportDatabase(): Promise<void> {
  const handle = await getSqliteDb()
  if (handle.persistence === 'memory') return
  await handle.sendCommand({ type: 'exportDatabase' })
}

/**
 * 定期エクスポートを開始する。
 *
 * 初回は即時実行し、以降 EXPORT_INTERVAL_MS ごとに繰り返す。
 * 返却されるクリーンアップ関数で停止可能。
 */
export function startPeriodicExport(): () => void {
  const run = () => {
    exportDatabase().catch((error) => {
      console.error('Failed to export database:', error)
    })
  }

  // 初回実行
  run()

  const intervalId = setInterval(run, EXPORT_INTERVAL_MS)

  return () => clearInterval(intervalId)
}
