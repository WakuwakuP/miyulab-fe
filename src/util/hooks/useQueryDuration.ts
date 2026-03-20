'use client'

import { useCallback, useState } from 'react'

/**
 * クエリ実行時間を記録し、最新 1 回の実行時間を返す Hook。
 *
 * @returns
 * - `recordDuration`: 実行時間（ms）を記録する関数
 * - `queryDuration`: 直近に記録した実行時間（ms）。未計測時は `null`
 */
export function useQueryDuration() {
  const [queryDuration, setQueryDuration] = useState<number | null>(null)

  const recordDuration = useCallback((durationMs: number) => {
    setQueryDuration(durationMs)
  }, [])

  return { queryDuration, recordDuration }
}
