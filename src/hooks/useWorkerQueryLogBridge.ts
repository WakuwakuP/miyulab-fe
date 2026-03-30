'use client'

/**
 * Worker → Server Action のブリッジ Hook
 *
 * WebWorker から postMessage で送られてくるスロークエリログを
 * Server Action に転送して Neon に保存する。
 */

import { createQueryLogs } from 'app/actions/queryLog.server'
import { useEffect } from 'react'
import { onSlowQueryLogs } from 'util/db/sqlite/workerClient'

/**
 * Worker のスロークエリログを Server Action へ転送するブリッジを設定する。
 *
 * アプリ起動時に 1 回だけ呼び出す（レイアウトまたはプロバイダ内）。
 */
export function useWorkerQueryLogBridge(): void {
  useEffect(() => {
    const unsubscribe = onSlowQueryLogs(async (logs) => {
      try {
        await createQueryLogs(logs)
      } catch (e) {
        console.error('[QueryLogBridge] Failed to send slow query logs:', e)
      }
    })

    return unsubscribe
  }, [])
}
