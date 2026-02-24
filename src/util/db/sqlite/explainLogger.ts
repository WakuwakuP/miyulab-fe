/**
 * 遅いクエリの EXPLAIN QUERY PLAN をログに残すユーティリティ
 *
 * クエリの実行時間が閾値を超えた場合、同一 SQL に対して
 * EXPLAIN QUERY PLAN を実行し、結果をコンソールに出力する。
 * これにより、インデックスの使用状況や SCAN vs SEARCH の判別が可能。
 */

// biome-ignore lint/suspicious/noExplicitAny: sqlite-wasm types are not exact
type RawDb = any

/** スローログの閾値（ミリ秒） */
const SLOW_QUERY_THRESHOLD_MS = 2000

/**
 * クエリの実行時間が閾値を超えた場合、EXPLAIN QUERY PLAN の結果をログに出力する
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

  try {
    const explainRows = db.exec(`EXPLAIN QUERY PLAN ${sql}`, {
      bind: bind ?? undefined,
      returnValue: 'resultRows',
    }) as unknown[][]

    console.warn(
      `[SlowQuery] ${durationMs.toFixed(1)}ms\n` +
        `  SQL: ${sql.trim().replace(/\s+/g, ' ').slice(0, 500)}\n` +
        `  Bind: ${JSON.stringify(bind ?? [])}\n` +
        `  EXPLAIN QUERY PLAN:\n${formatExplainRows(explainRows)}`,
    )
  } catch {
    // EXPLAIN 自体のエラーは無視（PRAGMA 等は EXPLAIN できない）
    console.warn(
      `[SlowQuery] ${durationMs.toFixed(1)}ms\n` +
        `  SQL: ${sql.trim().replace(/\s+/g, ' ').slice(0, 500)}\n` +
        `  Bind: ${JSON.stringify(bind ?? [])}\n` +
        '  (EXPLAIN QUERY PLAN failed)',
    )
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
