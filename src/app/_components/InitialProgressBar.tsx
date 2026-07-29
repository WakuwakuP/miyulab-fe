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
    <progress
      aria-busy="true"
      aria-label="初期化中"
      className="fixed top-0 right-0 left-0 z-50 h-1 w-full overflow-hidden bg-blue-950 accent-blue-500"
    />
  )
}
