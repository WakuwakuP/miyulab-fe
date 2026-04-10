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
  reportDequeue,
  reportEnqueue,
} from '../../dbQueue'
import {
  activeRequest,
  consecutiveOther,
  otherQueue,
  pending,
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
      const dedupKey = makeTimelineDedupKey(message)
      if (dedupKey != null) {
        const existing = timelineDedup.get(dedupKey)
        if (existing) {
          // 同じクエリが未処理なら新しく積まない — 結果を共有
          existing.resolvers.push(resolve)
          existing.rejectors.push(reject)
          return
        }
        timelineDedup.set(dedupKey, {
          rejectors: [reject],
          resolvers: [resolve],
        })
        // ラップされた resolve/reject で全待機者に通知する
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
          kind,
          message,
          reject: sharedReject,
          resolve: sharedResolve,
        })
        reportEnqueue('timeline')
        processQueue()
        return
      }
    }

    // sessionTag 付きタイムラインリクエスト: 同じ sessionTag のキュー内アイテムを
    // インプレース置換する。
    // cancelStaleRequests で削除 → 末尾に追加 のパターンでは、ストリーミング
    // イベントが高頻度で到着するとアイテムが常に末尾に押し戻され、
    // いつまでも処理されないスターベーション（飢餓）が発生する。
    // インプレース置換によりキュー内の位置を保持し、確実に処理順が回ってくるようにする。
    if (kind === 'timeline' && sessionTag) {
      const existingIndex = timelineQueue.findIndex(
        (item) => item.sessionTag === sessionTag,
      )
      if (existingIndex !== -1) {
        const old = timelineQueue[existingIndex]
        // 古いアイテムの Promise を undefined で解決（キャンセル扱い）
        old.resolve(undefined)
        // 同じ位置に新しいアイテムを配置（末尾に押し出さない）
        timelineQueue[existingIndex] = {
          kind,
          message,
          reject,
          resolve,
          sessionTag,
        }
        // reportEnqueue/reportDequeue は不要（キューサイズの純増減なし）
        processQueue()
        return
      }
    }

    const queue = kind === 'other' ? otherQueue : timelineQueue
    queue.push({ kind, message, reject, resolve, sessionTag })
    reportEnqueue(kind)
    processQueue()
  })
}

function processQueue(): void {
  if (activeRequest || !worker) return

  // other キューを優先するが、timeline キューの飢餓を防ぐため
  // maxConsecutiveOther 回連続処理したら timeline に譲る
  const maxConsecutive = getMaxConsecutiveOther(
    otherQueue.length,
    timelineQueue.length,
  )
  let next: QueuedRequest | undefined
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
  if (!next) return
  setActiveRequest(true)
  const { kind, message, resolve, reject } = next
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
