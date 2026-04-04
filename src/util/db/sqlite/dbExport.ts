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

/** 初回エクスポートの遅延: 起動直後の Worker ブロッキングを回避 */
const INITIAL_DELAY_MS = 120_000

/**
 * 定期エクスポートを開始する。
 *
 * 初回実行は INITIAL_DELAY_MS 後に遅延する。
 * 起動直後は bulkUpsertStatuses 等の初期ロード処理が Worker を使用するため、
 * 重い WAL checkpoint + DB シリアライズを即時実行するとタイムアウトの原因になる。
 * 以降 EXPORT_INTERVAL_MS ごとに繰り返す。
 * 返却されるクリーンアップ関数で停止可能。
 */
export function startPeriodicExport(): () => void {
  const run = () => {
    exportDatabase().catch((error) => {
      console.error('Failed to export database:', error)
    })
  }

  // 初回実行を遅延
  const initialTimer = setTimeout(run, INITIAL_DELAY_MS)

  const intervalId = setInterval(run, EXPORT_INTERVAL_MS)

  return () => {
    clearTimeout(initialTimer)
    clearInterval(intervalId)
  }
}
