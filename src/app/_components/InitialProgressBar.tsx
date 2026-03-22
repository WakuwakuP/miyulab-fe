'use client'

import { useOtherQueueProgress } from 'util/hooks/useOtherQueueProgress'

/**
 * 初回のOtherキューが処理完了するまで画面上部にプログレスバーを表示する。
 * キューが空になったら非表示になる。
 */
export const InitialProgressBar = () => {
  const { initializing } = useOtherQueueProgress()

  if (!initializing) return null

  return (
    <div className="fixed top-0 right-0 left-0 z-50 h-1 overflow-hidden bg-blue-950">
      <div className="animate-progress-bar h-full w-1/3 rounded-full bg-blue-500" />
    </div>
  )
}
