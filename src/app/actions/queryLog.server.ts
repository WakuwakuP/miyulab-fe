'use server'

/**
 * スロークエリログを Neon (PostgreSQL) に保存する Server Action
 *
 * Worker → main thread (postMessage) → この Server Action の順に呼ばれる。
 * DATABASE_URL 未設定時は何もしない。
 */

import { getNeonClient } from 'util/db/neon/client'

/** Server Action に渡す入力型 */
export type QueryLogInput = {
  sql: string
  bind?: string
  explainPlan?: string
  durationMs: number
  userAgent?: string
  timestamp?: string
}

/** Server Action のレスポンス型 */
type CreateQueryLogsResult =
  | { success: true; count: number }
  | { success: false; error: string }

/** サーバー側のバリデーション閾値（ミリ秒） */
const MIN_DURATION_MS = 2000

/** SQL の最大文字数 */
const MAX_SQL_LENGTH = 500

/** 1 回のリクエストで受け付ける最大件数 */
const MAX_BATCH_SIZE = 50

/** 簡易レート制御: 最後の保存時刻 */
let lastSaveTime = 0

/** 簡易レート制御: 最小間隔（ミリ秒） */
const RATE_LIMIT_MS = 2_000

/**
 * スロークエリログを一括保存する
 */
export async function createQueryLogs(
  logs: QueryLogInput[],
): Promise<CreateQueryLogsResult> {
  // DATABASE_URL 未設定ガード
  const client = getNeonClient()
  if (!client) {
    return { error: 'DATABASE_URL is not configured', success: false }
  }

  // レート制御
  const now = Date.now()
  if (now - lastSaveTime < RATE_LIMIT_MS) {
    return { error: 'Rate limited', success: false }
  }
  lastSaveTime = now

  // バッチサイズ制限
  const validLogs = logs.slice(0, MAX_BATCH_SIZE)

  // バリデーション & サニタイズ
  const filtered = validLogs.filter(
    (log) =>
      log.durationMs >= MIN_DURATION_MS &&
      typeof log.sql === 'string' &&
      log.sql.length > 0,
  )

  if (filtered.length === 0) {
    return { error: 'No valid logs after validation', success: false }
  }

  try {
    for (const log of filtered) {
      await client.queryLog.create({
        data: {
          bind: log.bind ?? null,
          durationMs: Math.round(log.durationMs),
          explainPlan: log.explainPlan ?? null,
          sql: log.sql.slice(0, MAX_SQL_LENGTH),
          userAgent: log.userAgent ?? null,
        },
      })
    }

    return { count: filtered.length, success: true }
  } catch (e) {
    console.error('[QueryLog] Failed to save query logs:', e)
    return {
      error: e instanceof Error ? e.message : 'Unknown error',
      success: false,
    }
  }
}
