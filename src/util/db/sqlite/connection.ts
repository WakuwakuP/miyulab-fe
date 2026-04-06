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
 *
 * ## ChangeHint (Plan B: スマート無効化)
 *
 * notifyChange にはオプションで ChangeHint を付与できる。
 * debounce 期間中に複数のストリームイベントが到着した場合、ヒントは配列として蓄積され
 * フラッシュ時にまとめてリスナーに渡される。
 * Hook 側で hints を検査し、自パネルに関係する変更かどうかを判定して
 * 不要な再クエリを抑制する。
 */

import { getDb } from './initSqlite'
import type { TableName } from './protocol'
import { isTableName } from './protocol'
import type { DbHandle } from './types'

export type { DbHandle, TableName }
export { isTableName }

/** 変更通知に付与するヒント情報 */
export type ChangeHint = {
  /** 変更が発生した timelineType ('home' | 'local' | 'public' | 'tag') */
  timelineType?: string
  /** 変更が発生した backendUrl */
  backendUrl?: string
  /** 変更に関連するタグ名 */
  tag?: string
  /** この書き込みバッチで変更された全テーブル名 */
  changedTables?: readonly string[]
}

/** 変更リスナー */
type ChangeListener = (hints: ChangeHint[]) => void

const listeners = new Map<TableName, Set<ChangeListener>>()

/**
 * テーブル変更を subscribe する
 *
 * 戻り値は unsubscribe 関数。
 * リスナーには debounce 期間中に蓄積された ChangeHint の配列が渡される。
 * ヒントが空配列の場合はヒントなし通知（ユーザー操作等）を意味する。
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

/** debounce 用: テーブル別ヒント蓄積 */
type PendingEntry = {
  hints: ChangeHint[]
  /** hint なしの notifyChange が 1 回でもあった場合 true */
  hasHintlessChange: boolean
}
const pendingByTable = new Map<TableName, PendingEntry>()

/** debounce 用: スケジュール済みタイマー ID */
let timerId: ReturnType<typeof setTimeout> | null = null

/**
 * 保留中の通知をフラッシュし、リスナーを発火する。
 *
 * テーブルごとに蓄積されたヒントを渡す。
 * hintless 変更があったテーブルは空配列を渡し、全サブスクライバーの再取得を保証する。
 */
function flushNotifications(): void {
  timerId = null
  const snapshot = new Map(pendingByTable)
  pendingByTable.clear()
  for (const [table, entry] of snapshot) {
    const set = listeners.get(table)
    if (!set) continue
    // hintless 変更があった場合は空配列 → 全サブスクライバーが再取得
    const hints = entry.hasHintlessChange ? [] : entry.hints
    for (const fn of set) {
      try {
        fn(hints)
      } catch (e) {
        console.error('Change listener error:', e)
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
 *
 * @param table - 変更されたテーブル名
 * @param hint - オプションの変更ヒント（timelineType / backendUrl / tag）
 */
export function notifyChange(table: TableName, hint?: ChangeHint): void {
  let entry = pendingByTable.get(table)
  if (!entry) {
    entry = { hasHintlessChange: false, hints: [] }
    pendingByTable.set(table, entry)
  }
  if (hint) {
    entry.hints.push(hint)
  } else {
    entry.hasHintlessChange = true
  }
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
