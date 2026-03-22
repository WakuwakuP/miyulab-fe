'use client'

import { useEffect, useRef, useState } from 'react'
import { getCurrentQueueSizes, subscribeQueueStats } from 'util/db/dbQueue'

/**
 * 初回のOtherキューが空になるまでの進捗を追跡するHook。
 *
 * - `initializing`: Otherキューがまだ処理中であれば `true`
 * - Otherキューが一度でも 0 になったら `false` に遷移し、以降は `false` を維持する
 *
 * タイムライン構築の初期化完了を判定するために使用する。
 */
export function useOtherQueueProgress(): {
  initializing: boolean
} {
  const [initializing, setInitializing] = useState(true)
  const doneRef = useRef(false)

  useEffect(() => {
    // 既に完了済みなら何もしない
    if (doneRef.current) return

    const check = () => {
      if (doneRef.current) return
      const { other } = getCurrentQueueSizes()
      if (other === 0) {
        doneRef.current = true
        setInitializing(false)
      }
    }

    // 初回チェック
    check()

    if (doneRef.current) return

    const unsub = subscribeQueueStats(check)
    return () => unsub()
  }, [])

  return { initializing }
}
