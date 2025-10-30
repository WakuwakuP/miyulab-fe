'use client'

import { useEffect, useState } from 'react'

import { FaPause } from 'react-icons/fa'

type StreamPauseIndicatorProps = {
  isPaused: boolean
  pausedAt: number | null
  reason: 'hidden' | 'frozen' | null
}

/**
 * Indicator showing that the stream is paused and for how long
 */
export const StreamPauseIndicator = ({
  isPaused,
  pausedAt,
  reason,
}: StreamPauseIndicatorProps) => {
  const [duration, setDuration] = useState<string>('')

  useEffect(() => {
    if (!isPaused || pausedAt == null) {
      setDuration('')
      return
    }

    const updateDuration = () => {
      const elapsed = Date.now() - pausedAt
      const seconds = Math.floor(elapsed / 1000)
      const minutes = Math.floor(seconds / 60)
      const hours = Math.floor(minutes / 60)

      if (hours > 0) {
        setDuration(`${hours}時間${minutes % 60}分`)
      } else if (minutes > 0) {
        setDuration(`${minutes}分${seconds % 60}秒`)
      } else {
        setDuration(`${seconds}秒`)
      }
    }

    updateDuration()
    const interval = setInterval(updateDuration, 1000)

    return () => {
      clearInterval(interval)
    }
  }, [isPaused, pausedAt])

  if (!isPaused) {
    return null
  }

  const reasonText =
    reason === 'frozen' ? '凍結中' : '非表示中'

  return (
    <div className="absolute left-0 right-0 top-0 z-20 bg-yellow-600/90 px-2 py-1 text-center text-sm text-white">
      <div className="flex items-center justify-center gap-2">
        <FaPause className="animate-pulse" />
        <span>
          {reasonText}: ストリーミング停止中
          {duration !== '' && ` (${duration})`}
        </span>
      </div>
    </div>
  )
}
