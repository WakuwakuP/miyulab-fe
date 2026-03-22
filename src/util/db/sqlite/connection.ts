/**
 * SQLite データベース シングルトン
 *
 * getDb() をラップし、変更通知 (change notification) を提供する。
 * React Hook はこの通知を subscribe して再クエリする。
 *
 * Worker モードでは changedTables レスポンスにより workerClient が
 * notifyChange を自動発火するため、Store 関数からの明示呼び出しは不要。
 *
 * notifyChange には 80ms の debounce が適用されており、ストリーミングの
 * バースト（数十 ms 間隔で複数テーブルが変更される）を吸収して
 * リスナーの発火回数を削減する。
 */

import { getDb } from './initSqlite'
import type { TableName } from './protocol'
import type { DbHandle } from './types'

export type { DbHandle, TableName }

/** 変更リスナー */
type ChangeListener = () => void

const listeners = new Map<TableName, Set<ChangeListener>>()

/**
 * テーブル変更を subscribe する
 *
 * 戻り値は unsubscribe 関数。
 */
export function subscribe(table: TableName, fn: ChangeListener): () => void {
  let set = listeners.get(table)
  if (!set) {
    set = new Set()
    listeners.set(table, set)
  }
  set.add(fn)
  return () => set.delete(fn)
}

/**
 * debounce 間隔 (ms)
 *
 * ストリーミングのバースト（数十 ms 間隔）を吸収しつつ、
 * ユーザー操作のフィードバックが遅延しすぎない値。
 */
const DEBOUNCE_MS = 80

/** debounce 用: フラッシュ待ちのテーブル名セット */
const pendingNotifications = new Set<TableName>()

/** debounce 用: スケジュール済みタイマー ID */
let timerId: ReturnType<typeof setTimeout> | null = null

/**
 * 保留中の通知をフラッシュし、リスナーを発火する。
 */
function flushNotifications(): void {
  timerId = null
  const tables = [...pendingNotifications]
  pendingNotifications.clear()
  for (const t of tables) {
    const set = listeners.get(t)
    if (set) {
      for (const fn of set) {
        try {
          fn()
        } catch (e) {
          console.error('Change listener error:', e)
        }
      }
    }
  }
}

/**
 * テーブル変更を通知する (80ms debounce 付き)
 *
 * Worker モードでは workerClient が changedTables を元に自動発火する。
 * フォールバックモードでは initSqlite.ts の sendCommand 内で発火する。
 * コンポーネント/Hook から直接呼ぶ場面（mute/block 等）でも使用可能。
 *
 * 短時間に複数回呼ばれた場合、80ms 以内の呼び出しをまとめて
 * 1 回のリスナー発火にバッチ化する。
 */
export function notifyChange(table: TableName): void {
  pendingNotifications.add(table)
  if (timerId != null) return
  timerId = setTimeout(flushNotifications, DEBOUNCE_MS)
}

let ready: Promise<DbHandle> | null = null

/**
 * 初期化済みの DB ハンドルを返す（スキーマはWorker/フォールバックで初期化済み）
 */
export function getSqliteDb(): Promise<DbHandle> {
  if (ready) return ready
  ready = getDb(notifyChange)
  return ready
}
