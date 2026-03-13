'use client'

import { useEffect, useState } from 'react'

type Listener = () => void
const listeners = new Map<string, Set<Listener>>()

/**
 * タイムラインの設定保存を通知する
 *
 * 対象のタイムラインIDに subscribeRefresh で登録されたリスナーを呼び出し、
 * useConfigRefresh の refreshToken をインクリメントさせることで
 * 各 Hook の再取得を確実にトリガーする。
 */
export function notifyRefresh(timelineId: string): void {
  const set = listeners.get(timelineId)
  if (set) {
    for (const fn of set) {
      try {
        fn()
      } catch (e) {
        console.error('Timeline refresh listener error:', e)
      }
    }
  }
}

function subscribeRefresh(timelineId: string, fn: Listener): () => void {
  let set = listeners.get(timelineId)
  if (!set) {
    set = new Set()
    listeners.set(timelineId, set)
  }
  set.add(fn)
  return () => set.delete(fn)
}

/**
 * タイムライン設定の保存を検知して再取得をトリガーする Hook
 *
 * notifyRefresh(timelineId) が呼ばれると refreshToken がインクリメントされ、
 * これを fetchData の依存配列に含めることで確実に再フェッチされる。
 */
export function useConfigRefresh(timelineId: string): number {
  const [refreshToken, setRefreshToken] = useState(0)
  useEffect(() => {
    if (!timelineId) return
    return subscribeRefresh(timelineId, () => setRefreshToken((v) => v + 1))
  }, [timelineId])
  return refreshToken
}
