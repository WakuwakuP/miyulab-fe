/**
 * SQLite データベース シングルトン
 *
 * getDb() + ensureSchema() をラップし、
 * 変更通知 (change notification) を提供する。
 *
 * React Hook はこの通知を subscribe して再クエリする。
 */

import type { DbHandle } from './initSqlite'
import { getDb } from './initSqlite'
import { ensureSchema } from './schema'

export type { DbHandle }

/** 変更対象テーブル */
export type TableName = 'statuses' | 'notifications'

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
 * テーブル変更を通知する（書き込み操作の後に呼ぶ）
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
 * 初期化済みの DB ハンドルを返す（スキーマ保証付き）
 */
export function getSqliteDb(): Promise<DbHandle> {
  if (ready) return ready
  ready = (async () => {
    const handle = await getDb()
    await ensureSchema(handle)
    return handle
  })()
  return ready
}
