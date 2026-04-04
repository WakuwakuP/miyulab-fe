/**
 * 汎用 SQL 実行ハンドラ
 *
 * exec / execBatch メッセージの処理ロジック。
 */

import { logSlowQueryExplain } from '../explainLogger'
import { getDb } from './workerState'

export function handleExec(
  sql: string,
  bind?: (string | number | null)[],
  returnValue?: string,
): { result: unknown; durationMs: number } {
  const db = getDb()
  const start = performance.now()
  let result: unknown
  if (returnValue === 'resultRows') {
    result = db.exec(sql, {
      bind: bind ?? undefined,
      returnValue: 'resultRows',
    })
  } else {
    db.exec(sql, { bind: bind ?? undefined })
    result = undefined
  }
  const durationMs = performance.now() - start
  logSlowQueryExplain(db, sql, bind, durationMs)
  return { durationMs, result }
}

export function handleExecBatch(
  statements: {
    sql: string
    bind?: (string | number | null)[]
    returnValue?: string
  }[],
  rollbackOnError: boolean,
  returnIndices?: number[],
): unknown {
  const db = getDb()
  const results = new Map<number, unknown>()
  const shouldReturn = new Set(returnIndices ?? [])

  if (rollbackOnError) {
    db.exec('BEGIN;')
  }

  try {
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]
      const { result } = handleExec(stmt.sql, stmt.bind, stmt.returnValue)
      if (shouldReturn.has(i) || !returnIndices) {
        results.set(i, result)
      }
    }

    if (rollbackOnError) {
      db.exec('COMMIT;')
    }
  } catch (e) {
    if (rollbackOnError) {
      try {
        db.exec('ROLLBACK;')
      } catch {
        /* ロールバックエラーは無視 */
      }
    }
    throw e
  }

  const resultObj: Record<number, unknown> = {}
  for (const [k, v] of results) {
    resultObj[k] = v
  }
  return resultObj
}
