'use client'

import { useEffect, useRef, useState } from 'react'
import {
  getCurrentQueueSizes,
  hasOtherQueueBeenActive,
  subscribeQueueStats,
} from 'util/db/dbQueue'

/**
 * 初回のOtherキューが空になるまでの進捗を追跡するHook。
 *
 * - `initializing`: Otherキューがまだ処理中であれば `true`
 * - Otherキューに一度でもアイテムが追加され、その後 0 になったら `false` に遷移し、
 *   以降は `false` を維持する
 * - キューへのアイテム追加前に 0 であっても `false` にはしない（レース回避）
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
      // キューがまだ一度も使われていなければ完了とみなさない
      if (!hasOtherQueueBeenActive()) return
      const { other } = getCurrentQueueSizes()
      if (other === 0) {
        doneRef.current = true
        setInitializing(false)
      }
    }

    // サブスクリプションを先に設定して、初回チェックとの間の遷移を逃さない
    const unsub = subscribeQueueStats(check)

    // 初回チェック
    check()

    return () => unsub()
  }, [])

  return { initializing }
}
