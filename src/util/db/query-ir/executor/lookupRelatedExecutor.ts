// ============================================================
// Graph Executor — LookupRelated ノードエグゼキュータ
//
// 上流ノードの出力 ID リストから関連テーブルの ID を相関検索する。
// joinConditions, timeCondition, aggregate に基づいて SQL を生成する。
// ============================================================

import type { DbExec } from '../../sqlite/queries/executionEngine'
import { getDefaultTimeColumn, resolveOutputTable } from '../completion'
import type { BindValue, LookupRelatedNode } from '../nodes'
import type { NodeOutputRow } from '../plan'
import type { NodeOutput } from './types'

/**
 * LookupRelated ノードを実行し、NodeOutput を返す。
 *
 * @param db - SQLite 実行ハンドル
 * @param node - LookupRelated ノード定義
 * @param input - 上流ノードの出力
 */
export function executeLookupRelated(
  db: DbExec,
  node: LookupRelatedNode,
  input: NodeOutput,
): {
  output: NodeOutput
  sql: string
  binds: BindValue[]
  dependentTables: string[]
} {
  if (input.rows.length === 0) {
    return {
      binds: [],
      dependentTables: [node.lookupTable, input.sourceTable],
      output: { hash: 'lookup:empty', rows: [], sourceTable: node.lookupTable },
      sql: '',
    }
  }

  const lt = 'lt' // lookup table alias
  const binds: BindValue[] = []
  const conditions: string[] = []
  const dependentTables = [node.lookupTable, input.sourceTable]

  // --- JOIN 条件: 上流 IDs を IN 句で注入 ---
  for (const jc of node.joinConditions) {
    const ids = input.rows.map((r) => r.id)
    const placeholders = ids.map(() => '?').join(', ')

    if (jc.resolve) {
      // 明示的 resolve: 中間テーブル経由
      conditions.push(
        `${lt}.${jc.lookupColumn} IN (SELECT ${jc.resolve.matchColumn} FROM ${jc.resolve.via} WHERE ${jc.resolve.inputKey} IN (${placeholders}))`,
      )
      binds.push(...ids)
      dependentTables.push(jc.resolve.via)
    } else if (jc.inputColumn && jc.inputColumn !== 'id') {
      // inputColumn 自動解決: 上流テーブルから inputColumn を subquery で取得
      conditions.push(
        `${lt}.${jc.lookupColumn} IN (SELECT ${jc.inputColumn} FROM ${input.sourceTable} WHERE id IN (${placeholders}))`,
      )
      binds.push(...ids)
    } else {
      // 直接 JOIN: 上流の ID を lookupColumn に直接マッチ
      conditions.push(`${lt}.${jc.lookupColumn} IN (${placeholders})`)
      binds.push(...ids)
    }
  }

  // --- 時間条件 ---
  if (node.timeCondition) {
    const tc = node.timeCondition
    // 上流の時間範囲を利用して検索範囲を絞る
    const minTime = Math.min(...input.rows.map((r) => r.createdAtMs))
    const maxTime = Math.max(...input.rows.map((r) => r.createdAtMs))

    if (tc.afterInput) {
      // 上流より後: lookupTime > inputTime AND lookupTime <= inputTime + windowMs
      conditions.push(`${lt}.${tc.lookupTimeColumn} > ?`)
      binds.push(minTime)
      conditions.push(`${lt}.${tc.lookupTimeColumn} <= ?`)
      binds.push(maxTime + tc.windowMs)
    } else {
      // 上流より前: lookupTime < inputTime AND lookupTime >= inputTime - windowMs
      conditions.push(`${lt}.${tc.lookupTimeColumn} < ?`)
      binds.push(maxTime)
      conditions.push(`${lt}.${tc.lookupTimeColumn} >= ?`)
      binds.push(minTime - tc.windowMs)
    }
  }

  // --- SELECT 句構築 ---
  let selectExpr: string
  let groupByStr = ''

  if (node.aggregate) {
    // 集約モード: MIN/MAX
    selectExpr = `${lt}.id AS id, ${node.aggregate.function}(${lt}.${node.aggregate.column}) AS created_at_ms`
    groupByStr = `GROUP BY ${lt}.id`
  } else {
    const defaultTimeCol = getDefaultTimeColumn(node.lookupTable)
    selectExpr = defaultTimeCol
      ? `${lt}.id AS id, ${lt}.${defaultTimeCol} AS created_at_ms`
      : `${lt}.id AS id, 0 AS created_at_ms`
  }

  const whereStr =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const sql = [
    `SELECT ${selectExpr}`,
    `FROM ${node.lookupTable} ${lt}`,
    whereStr,
    groupByStr,
    `ORDER BY created_at_ms DESC`,
  ]
    .filter(Boolean)
    .join(' ')

  const rawRows = db.exec(sql, {
    bind: binds.length > 0 ? binds : undefined,
    returnValue: 'resultRows',
  })

  // LookupRelated は常に lookupTable の id を出力する
  const outputTable = resolveOutputTable(node.lookupTable, 'id')

  const rows: NodeOutputRow[] = rawRows.map((row) => ({
    createdAtMs: row[1] as number,
    id: row[0] as number,
    table: outputTable,
  }))

  const hash = `lookup:${sql}:${JSON.stringify(binds)}:${rows.length}`

  return {
    binds,
    dependentTables,
    output: { hash, rows, sourceTable: outputTable },
    sql,
  }
}
