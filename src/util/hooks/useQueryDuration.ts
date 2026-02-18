'use client'

import { useCallback, useRef, useState } from 'react'

const HISTORY_SIZE = 10

/**
 * クエリ実行時間を記録し、直近数件の平均値を返すHook
 *
 * - recordDuration: 実行時間(ms)を記録する関数
 * - averageDuration: 直近 HISTORY_SIZE 件の平均実行時間(ms)。未計測時は null
 */
export function useQueryDuration() {
  const durationsRef = useRef<number[]>([])
  const [averageDuration, setAverageDuration] = useState<number | null>(null)

  const recordDuration = useCallback((durationMs: number) => {
    const durations = durationsRef.current
    durations.push(durationMs)
    if (durations.length > HISTORY_SIZE) {
      durations.shift()
    }
    const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length
    setAverageDuration(avg)
  }, [])

  return { averageDuration, recordDuration }
}
