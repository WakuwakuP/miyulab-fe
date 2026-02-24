'use client'

import { useCallback, useState } from 'react'

/**
 * クエリ実行時間を記録し、最新1回の実行時間を返すHook
 *
 * - recordDuration: 実行時間(ms)を記録する関数
 * - averageDuration: 最新1回の実行時間(ms)。未計測時は null
 */
export function useQueryDuration() {
  const [averageDuration, setAverageDuration] = useState<number | null>(null)

  const recordDuration = useCallback((durationMs: number) => {
    setAverageDuration(durationMs)
  }, [])

  return { averageDuration, recordDuration }
}
