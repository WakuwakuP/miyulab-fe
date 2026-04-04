/**
 * SQLite ベースのクリーンアップ
 *
 * MAX_LENGTH 管理を SQL で効率的に行う。
 * TTL は設けず、MAX_LENGTH を超えるまでデータを半永久的に保持する。
 *
 * Worker モードでは sendCommand で Worker に委譲する。
 */

import { getSqliteDb } from './connection'

/**
 * MAX_LENGTH を超えるデータを削除 — Worker に委譲
 */
export async function enforceMaxLength(): Promise<void> {
  const handle = await getSqliteDb()
  await handle.sendCommand({ type: 'enforceMaxLength' })
}

/** 初回クリーンアップの遅延: 起動直後の Worker ブロッキングを回避 */
const INITIAL_DELAY_MS = 60_000

/**
 * 定期クリーンアップの開始
 *
 * 初回実行は INITIAL_DELAY_MS 後に遅延する。
 * 起動直後は bulkUpsertStatuses 等の初期ロード処理が Worker を使用するため、
 * 重い enforceMaxLength を即時実行するとタイムアウトの原因になる。
 */
export function startPeriodicCleanup(): () => void {
  // 初回実行を遅延
  const initialTimer = setTimeout(() => {
    void (async () => {
      try {
        await enforceMaxLength()
      } catch (error) {
        console.error('Failed to perform initial periodic cleanup', error)
      }
    })()
  }, INITIAL_DELAY_MS)

  // 1時間ごとに実行
  const intervalId = setInterval(
    () => {
      void (async () => {
        try {
          await enforceMaxLength()
        } catch (error) {
          console.error('Failed to perform periodic cleanup', error)
        }
      })()
    },
    60 * 60 * 1000,
  )

  return () => {
    clearTimeout(initialTimer)
    clearInterval(intervalId)
  }
}
