/**
 * キュー管理 — リクエストの直列化・重複排除・Stale キャンセル
 *
 * other キュー（書き込み・管理系読み込み等）と timeline キュー（タイムライン取得）
 * の 2 本立てで、other キューを優先的に処理する。
 * timeline キューは同一クエリ (SQL + bind + returnValue) が未処理なら重複追加しない。
 */

import type { QueueKind } from '../../dbQueue'
import {
  getMaxConsecutiveOther,
  MAX_TIMELINE_QUEUE_SIZE,
  recordWaitTime,
  reportDequeue,
  reportEnqueue,
} from '../../dbQueue'
import {
  activeRequest,
  consecutiveOther,
  otherQueue,
  pending,
  priorityQueue,
  setActiveRequest,
  setConsecutiveOther,
  TIMEOUT_BY_TYPE,
  TIMEOUT_MS,
  timelineDedup,
  timelineQueue,
  worker,
} from './state'
import type { QueuedRequest } from './types'

// ================================================================
// タイムラインキュー重複排除ユーティリティ
// ================================================================

/**
 * タイムラインキューが上限を超えている場合に最古のリクエストを破棄する。
 * 破棄されたリクエストの Promise は undefined で resolve される。
 * ストリーミング差分取得では次の通知で再取得されるため破棄しても一貫性は保たれる。
 */
function evictOldestIfOverflow(): void {
  while (timelineQueue.length > MAX_TIMELINE_QUEUE_SIZE) {
    const oldest = timelineQueue.shift()
    if (oldest) {
      reportDequeue('timeline')
      oldest.resolve(undefined)
    }
  }
}

/**
 * exec リクエストの SQL + bind + returnValue からタイムラインキュー重複排除用キーを生成する。
 * returnValue が異なると結果の形式が変わるため、キーに含める。
 */
function makeTimelineDedupKey(message: {
  [key: string]: unknown
}): string | null {
  if (message.type === 'exec') {
    const sql = message.sql as string
    const bind = message.bind as unknown[] | undefined
    const returnValue = message.returnValue as string | undefined

    const parts: string[] = [sql]
    if (bind !== undefined) {
      parts.push(JSON.stringify(bind))
    }
    if (returnValue !== undefined) {
      parts.push(returnValue)
    }
    return parts.join('\0')
  }
  if (message.type === 'fetchTimeline') {
    const phase1 = message.phase1 as { sql: string; bind?: unknown[] }
    const parts = ['fetchTimeline', phase1.sql]
    if (phase1.bind) parts.push(JSON.stringify(phase1.bind))
    return parts.join('\0')
  }
  return null
}

function getQueueForKind(kind: QueueKind): QueuedRequest[] {
  if (kind === 'priority') return priorityQueue
  if (kind === 'other') return otherQueue
  return timelineQueue
}

/**
 * タイムラインキューへ重複排除付きで積む。処理済みなら true。
 */
function tryEnqueueTimelineDedup(
  message: {
    type: string
    id: number
    [key: string]: unknown
  },
  resolve: (value: unknown) => void,
  reject: (reason: Error) => void,
): boolean {
  const dedupKey = makeTimelineDedupKey(message)
  if (dedupKey == null) return false

  const existing = timelineDedup.get(dedupKey)
  if (existing) {
    existing.resolvers.push(resolve)
    existing.rejectors.push(reject)
    return true
  }

  timelineDedup.set(dedupKey, {
    rejectors: [reject],
    resolvers: [resolve],
  })
  const sharedResolve = (value: unknown) => {
    const entry = timelineDedup.get(dedupKey)
    timelineDedup.delete(dedupKey)
    if (entry) {
      for (const r of entry.resolvers) r(value)
    }
  }
  const sharedReject = (reason: Error) => {
    const entry = timelineDedup.get(dedupKey)
    timelineDedup.delete(dedupKey)
    if (entry) {
      for (const r of entry.rejectors) r(reason)
    }
  }
  timelineQueue.push({
    enqueuedAt: performance.now(),
    kind: 'timeline',
    message,
    reject: sharedReject,
    resolve: sharedResolve,
  })
  reportEnqueue('timeline')
  evictOldestIfOverflow()
  processQueue()
  return true
}

/**
 * sessionTag 一致のタイムラインキューアイテムをインプレース置換する。置換したら true。
 */
function tryReplaceTimelineSessionTag(
  sessionTag: string,
  message: {
    type: string
    id: number
    [key: string]: unknown
  },
  resolve: (value: unknown) => void,
  reject: (reason: Error) => void,
): boolean {
  const existingIndex = timelineQueue.findIndex(
    (item) => item.sessionTag === sessionTag,
  )
  if (existingIndex === -1) return false

  const old = timelineQueue[existingIndex]
  old.resolve(undefined)
  timelineQueue[existingIndex] = {
    enqueuedAt: old.enqueuedAt,
    kind: 'timeline',
    message,
    reject,
    resolve,
    sessionTag,
  }
  processQueue()
  return true
}

// ================================================================
// Stale キャンセル API
// ================================================================

/**
 * 指定した sessionTag を持つ未処理の timeline キューアイテムを除去する。
 * 除去されたアイテムの Promise は staleValue で即時 resolve される。
 *
 * activeRequest（Worker に送信済み）のアイテムはキャンセルできない。
 * キューに待機中のアイテムのみが対象。
 *
 * @param sessionTag - 除去対象のセッションタグ
 * @param staleValue - 除去されたリクエストの resolve に渡す値（デフォルト: undefined）
 * @returns 除去されたアイテム数
 */
export function cancelStaleRequests(
  sessionTag: string,
  staleValue?: unknown,
): number {
  let cancelled = 0
  for (let i = timelineQueue.length - 1; i >= 0; i--) {
    const item = timelineQueue[i]
    if (item.sessionTag === sessionTag) {
      timelineQueue.splice(i, 1)
      reportDequeue('timeline')
      item.resolve(staleValue)
      cancelled++
    }
  }
  return cancelled
}

// ================================================================
// キュー操作
// ================================================================

/**
 * リクエストをキューに追加し、順番に Worker へ送信する。
 *
 * Worker はシングルスレッドでメッセージを逐次処理するため、
 * 一度に複数の postMessage を送ると後続リクエストのタイムアウトが
 * 実際の処理時間ではなくキュー待ち時間を含んでしまう。
 * キューで直列化し、タイムアウトは実際に送信した時点から計測する。
 *
 * kind='timeline' の場合、同一クエリが既にキューにあれば新たに積まず
 * 既存リクエストの結果を共有する（dedup）。
 *
 * sessionTag 付きの timeline リクエストは dedup をスキップするが、
 * 同じ sessionTag のアイテムがキューに残っていれば **インプレース置換** する。
 * これにより cancelStaleRequests + 末尾追加パターンで発生する
 * タイムラインキューのスターベーション（飢餓）を防ぐ。
 */
export function sendRequest(
  message: {
    type: string
    id: number
    [key: string]: unknown
  },
  kind: QueueKind = 'other',
  sessionTag?: string,
): Promise<unknown> {
  if (!worker) {
    return Promise.reject(new Error('Worker not initialized'))
  }

  return new Promise<unknown>((resolve, reject) => {
    // タイムラインキューの重複排除（sessionTag 付きはスキップ）
    if (kind === 'timeline' && !sessionTag) {
      if (tryEnqueueTimelineDedup(message, resolve, reject)) return
    }

    // sessionTag 付き: 同じ sessionTag のキュー内アイテムをインプレース置換
    if (kind === 'timeline' && sessionTag) {
      if (
        tryReplaceTimelineSessionTag(sessionTag, message, resolve, reject)
      ) {
        return
      }
    }

    const queue = getQueueForKind(kind)
    const enqueuedAt = kind === 'timeline' ? performance.now() : undefined
    queue.push({ enqueuedAt, kind, message, reject, resolve, sessionTag })
    reportEnqueue(kind)
    if (kind === 'timeline') {
      evictOldestIfOverflow()
    }
    processQueue()
  })
}

function processQueue(): void {
  if (activeRequest || !worker) return

  // priority キューは常に最優先で処理する（maxConsecutiveOther の制約外）
  let next: QueuedRequest | undefined
  if (priorityQueue.length > 0) {
    next = priorityQueue.shift()
    // priority 処理は consecutiveOther カウンタに影響させない
  } else {
    // other キューを優先するが、timeline キューの飢餓を防ぐため
    // maxConsecutiveOther 回連続処理したら timeline に譲る
    const maxConsecutive = getMaxConsecutiveOther(
      otherQueue.length,
      timelineQueue.length,
    )
    if (
      otherQueue.length > 0 &&
      (timelineQueue.length === 0 || consecutiveOther < maxConsecutive)
    ) {
      next = otherQueue.shift()
      setConsecutiveOther(consecutiveOther + 1)
    } else if (timelineQueue.length > 0) {
      next = timelineQueue.shift()
      setConsecutiveOther(0)
    }
  }
  if (!next) return
  setActiveRequest(true)
  const { kind, message, resolve, reject } = next
  // timeline キューの待機時間を記録
  if (kind === 'timeline' && next.enqueuedAt != null) {
    recordWaitTime(performance.now() - next.enqueuedAt)
  }
  const id = message.id
  const timeoutMs = TIMEOUT_BY_TYPE[message.type] ?? TIMEOUT_MS

  const timer = setTimeout(() => {
    pending.delete(id)
    setActiveRequest(false)
    reportDequeue(kind)
    reject(
      new Error(`Worker request timed out (id=${id}, type=${message.type})`),
    )
    processQueue()
  }, timeoutMs)

  pending.set(id, {
    kind,
    reject: (reason: Error) => {
      clearTimeout(timer)
      setActiveRequest(false)
      reportDequeue(kind)
      reject(reason)
      processQueue()
    },
    resolve: (value: unknown) => {
      clearTimeout(timer)
      setActiveRequest(false)
      reportDequeue(kind)
      resolve(value)
      processQueue()
    },
    timer,
  })

  worker.postMessage(message)
}
