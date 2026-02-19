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

/**
 * 定期クリーンアップの開始
 */
export function startPeriodicCleanup(): () => void {
  // 初回実行
  void (async () => {
    try {
      await enforceMaxLength()
    } catch (error) {
      console.error('Failed to perform initial periodic cleanup', error)
    }
  })()

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

  return () => clearInterval(intervalId)
}
