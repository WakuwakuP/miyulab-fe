/**
 * SQLite データベース シングルトン
 *
 * getDb() をラップし、変更通知 (change notification) を提供する。
 * React Hook はこの通知を subscribe して再クエリする。
 *
 * Worker モードでは changedTables レスポンスにより workerClient が
 * notifyChange を自動発火するため、Store 関数からの明示呼び出しは不要。
 */

import { getDb } from './initSqlite'
import type { TableName } from './protocol'
import type { DbHandle } from './types'

export type { DbHandle }
export type { TableName }

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
 * テーブル変更を通知する
 *
 * Worker モードでは workerClient が changedTables を元に自動発火する。
 * フォールバックモードでは initSqlite.ts の sendCommand 内で発火する。
 * コンポーネント/Hook から直接呼ぶ場面（mute/block 等）でも使用可能。
 */
export function notifyChange(table: TableName): void {
  const set = listeners.get(table)
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

let ready: Promise<DbHandle> | null = null

/**
 * 初期化済みの DB ハンドルを返す（スキーマはWorker/フォールバックで初期化済み）
 */
export function getSqliteDb(): Promise<DbHandle> {
  if (ready) return ready
  ready = getDb(notifyChange)
  return ready
}
