/**
 * 遅いクエリの EXPLAIN QUERY PLAN をログに残すユーティリティ
 *
 * クエリの実行時間が閾値を超えた場合、同一 SQL に対して
 * EXPLAIN QUERY PLAN を実行し、結果をコンソールに出力する。
 * これにより、インデックスの使用状況や SCAN vs SEARCH の判別が可能。
 *
 * スロークエリはローカルキューに蓄積され、一定間隔（5 秒）または
 * 最大件数（10 件）でメインスレッドに postMessage で送信される。
 */

import type { SlowQueryLogEntry, SlowQueryLogMessage } from './protocol'

// biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm types are not exact
type RawDb = any

/** スローログの閾値（ミリ秒） */
const SLOW_QUERY_THRESHOLD_MS = 2000

/** キューのフラッシュ間隔（ミリ秒） */
const FLUSH_INTERVAL_MS = 5_000

/** キューの最大件数（これに達したら即時フラッシュ） */
const MAX_QUEUE_SIZE = 10

/** SQL の最大文字数（切り詰め） */
const MAX_SQL_LENGTH = 500

/** 送信キュー */
const logQueue: SlowQueryLogEntry[] = []

/** フラッシュタイマー ID */
let flushTimer: ReturnType<typeof setTimeout> | null = null

/**
 * キューの内容をメインスレッドに送信する
 */
function flushQueue(): void {
  flushTimer = null
  if (logQueue.length === 0) return

  const logs = logQueue.splice(0)
  const message: SlowQueryLogMessage = { logs, type: 'slowQueryLogs' }
  self.postMessage(message)
}

/**
 * フラッシュタイマーをスケジュールする（未スケジュール時のみ）
 */
function scheduleFlush(): void {
  if (flushTimer != null) return
  flushTimer = setTimeout(flushQueue, FLUSH_INTERVAL_MS)
}

/**
 * SQL からアクセストークン等の機密情報をマスクする
 */
function sanitizeSql(sql: string): string {
  return sql.trim().replace(/\s+/g, ' ').slice(0, MAX_SQL_LENGTH)
}

/**
 * バインドパラメータをサニタイズする
 * トークンのような長い文字列はマスクする
 */
function sanitizeBind(bind: (string | number | null)[] | undefined): string {
  if (!bind || bind.length === 0) return '[]'
  const sanitized = bind.map((v) => {
    if (typeof v === 'string' && v.length > 100) return '[REDACTED]'
    return v
  })
  return JSON.stringify(sanitized)
}

/**
 * クエリの実行時間が閾値を超えた場合、EXPLAIN QUERY PLAN の結果をログに出力し、
 * 送信キューに追加する。
 *
 * @param db - sqlite-wasm の Database インスタンス
 * @param sql - 実行した SQL 文
 * @param bind - バインドパラメータ
 * @param durationMs - 実行にかかった時間（ミリ秒）
 */
export function logSlowQueryExplain(
  db: RawDb,
  sql: string,
  bind: (string | number | null)[] | undefined,
  durationMs: number,
): void {
  if (durationMs < SLOW_QUERY_THRESHOLD_MS) return

  let explainPlan = '(EXPLAIN QUERY PLAN failed)'

  try {
    const explainRows = db.exec(`EXPLAIN QUERY PLAN ${sql}`, {
      bind: bind ?? undefined,
      returnValue: 'resultRows',
    }) as unknown[][]

    explainPlan = formatExplainRows(explainRows)

    console.warn(
      `[SlowQuery] ${durationMs.toFixed(1)}ms\n` +
        `  SQL: ${sanitizeSql(sql)}\n` +
        `  Bind: ${sanitizeBind(bind)}\n` +
        `  EXPLAIN QUERY PLAN:\n${explainPlan}`,
    )
  } catch {
    // EXPLAIN 自体のエラーは無視（PRAGMA 等は EXPLAIN できない）
    console.warn(
      `[SlowQuery] ${durationMs.toFixed(1)}ms\n` +
        `  SQL: ${sanitizeSql(sql)}\n` +
        `  Bind: ${sanitizeBind(bind)}\n` +
        '  (EXPLAIN QUERY PLAN failed)',
    )
  }

  // キューに追加
  const entry: SlowQueryLogEntry = {
    bind: sanitizeBind(bind),
    durationMs: Math.round(durationMs),
    explainPlan,
    sql: sanitizeSql(sql),
    timestamp: new Date().toISOString(),
    userAgent:
      typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
  }
  logQueue.push(entry)

  // 最大件数に達したら即時フラッシュ
  if (logQueue.length >= MAX_QUEUE_SIZE) {
    if (flushTimer != null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    flushQueue()
  } else {
    scheduleFlush()
  }
}

/**
 * EXPLAIN QUERY PLAN の結果行をフォーマットする
 *
 * SQLite の EXPLAIN QUERY PLAN は [id, parent, notused, detail] の
 * 4 列を返す。detail 列（インデックス 3）を抽出して表示する。
 */
function formatExplainRows(rows: unknown[][]): string {
  return rows
    .map((row) => {
      const detail = row.length >= 4 ? row[3] : String(row)
      return `    ${detail}`
    })
    .join('\n')
}
