// ============================================================
// Graph Executor — GetIds ノードエグゼキュータ
//
// テーブルからフィルタ条件に基づいて [{id, createdAtMs}] を取得する。
// 既存の filterToSql / sourceToSql を活用して SQL を生成する。
// ============================================================

import type { DbExec } from '../../sqlite/queries/executionEngine'
import { getDefaultTimeColumn, resolveOutputTable } from '../completion'
import type {
  BindValue,
  ExistsFilter,
  FilterNode,
  FilterOp,
  FilterValue,
  GetIdsFilter,
  GetIdsNode,
  TableFilter,
} from '../nodes'
import type { JoinClause, NodeOutputRow } from '../plan'
import { compileFilterNode } from '../translate/filterToSql'
import { buildJoinString, getSourceAlias } from '../translate/sourceToSql'
import type { NodeOutput } from './types'

// --------------- フィルタ変換ヘルパー ---------------

function getIdsFilterToFilterNode(f: GetIdsFilter): FilterNode {
  if ('column' in f && 'op' in f) {
    return {
      column: f.column,
      kind: 'table-filter',
      op: f.op as FilterOp,
      table: f.table,
      value: f.value as FilterValue,
    } satisfies TableFilter
  }
  return {
    countValue: (f as ExistsFilter).countValue,
    innerFilters: (f as ExistsFilter).innerFilters?.map((inner) => ({
      column: inner.column,
      kind: 'table-filter' as const,
      op: inner.op as FilterOp,
      table: inner.table,
      value: inner.value as FilterValue,
    })),
    kind: 'exists-filter',
    mode: (f as ExistsFilter).mode,
    table: f.table,
  } satisfies ExistsFilter
}

// --------------- SQL 生成 ---------------

export type GetIdsCompileResult = {
  sql: string
  binds: BindValue[]
  /** フィルタが参照するテーブル名一覧（キャッシュ依存追跡用） */
  dependentTables: string[]
}

/**
 * GetIdsNode から SELECT id, created_at_ms SQL を生成する。
 *
 * @param node - GetIds ノード定義
 * @param upstreamOutputs - 上流ノードの出力 (inputBindings で参照)
 * @param limit - 結果行数上限（Output ノードの pagination.limit を使用）
 */
export function compileGetIds(
  node: GetIdsNode,
  upstreamOutputs: Map<string, NodeOutput>,
  limit?: number,
): GetIdsCompileResult {
  const alias = getSourceAlias(node.table)
  const idCol = node.outputIdColumn ?? 'id'
  const timeCol =
    node.outputTimeColumn !== null
      ? (node.outputTimeColumn ?? getDefaultTimeColumn(node.table))
      : null

  const whereConditions: string[] = []
  const allBinds: BindValue[] = []
  const allJoins: JoinClause[] = []
  const dependentTables = new Set<string>([node.table])

  // --- 通常フィルタ ---
  for (const filter of node.filters) {
    // upstreamSourceNodeId がある場合は上流ノードの出力IDを値として注入
    let effectiveFilter = filter
    if ('upstreamSourceNodeId' in filter && filter.upstreamSourceNodeId) {
      const upstream = upstreamOutputs.get(filter.upstreamSourceNodeId)
      if (upstream && upstream.rows.length > 0) {
        const ids = upstream.rows.map((r) => r.id)
        effectiveFilter = { ...filter, value: ids }
      } else {
        // 上流が空: IN → 結果なし (空配列), NOT IN → 全パス (空配列)
        effectiveFilter = { ...filter, value: [] }
      }
    }

    const filterNode = getIdsFilterToFilterNode(effectiveFilter)
    const compiled = compileFilterNode(filterNode, node.table, alias)
    if (compiled.sql && compiled.sql !== '1=1') {
      whereConditions.push(compiled.sql)
    }
    allBinds.push(...compiled.binds)
    allJoins.push(...compiled.joins)
    dependentTables.add(filter.table)
  }

  // --- OR ブランチ ---
  if (node.orBranches && node.orBranches.length > 0) {
    const branchSqls: string[] = []
    for (const branch of node.orBranches) {
      const branchConditions: string[] = []
      for (const filter of branch) {
        const filterNode = getIdsFilterToFilterNode(filter)
        const compiled = compileFilterNode(filterNode, node.table, alias)
        if (compiled.sql && compiled.sql !== '1=1') {
          branchConditions.push(compiled.sql)
        }
        allBinds.push(...compiled.binds)
        allJoins.push(...compiled.joins)
        dependentTables.add(filter.table)
      }
      if (branchConditions.length > 0) {
        branchSqls.push(
          branchConditions.length === 1
            ? branchConditions[0]
            : `(${branchConditions.join(' AND ')})`,
        )
      }
    }
    if (branchSqls.length > 0) {
      whereConditions.push(
        branchSqls.length === 1
          ? branchSqls[0]
          : `(${branchSqls.join(' OR ')})`,
      )
    }
  }

  // --- カーソル条件 ---
  if (node.cursor) {
    whereConditions.push(`${alias}.${node.cursor.column} ${node.cursor.op} ?`)
    allBinds.push(node.cursor.value)
  }

  // --- JOIN 重複排除 ---
  const seenAliases = new Set<string>()
  const uniqueJoins = allJoins.filter((j) => {
    if (seenAliases.has(j.alias)) return false
    seenAliases.add(j.alias)
    return true
  })

  // --- GROUP BY (1:N JOIN がある場合) ---
  const needsGroupBy = uniqueJoins.some((j) => j.type === 'inner')

  // --- SQL 組み立て ---
  const joinStr = buildJoinString(uniqueJoins)
  const whereStr =
    whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''
  const groupByStr = needsGroupBy ? `GROUP BY ${alias}.${idCol}` : ''
  const limitStr = limit != null ? `LIMIT ${limit}` : ''

  const selectTime = timeCol
    ? `${alias}.${timeCol} AS created_at_ms`
    : '0 AS created_at_ms'
  const orderBy = timeCol
    ? `ORDER BY ${alias}.${timeCol} DESC`
    : `ORDER BY ${alias}.rowid DESC`

  const sql = [
    `SELECT ${alias}.${idCol} AS id, ${selectTime}`,
    `FROM ${node.table} ${alias}`,
    joinStr,
    whereStr,
    groupByStr,
    orderBy,
    limitStr,
  ]
    .filter(Boolean)
    .join(' ')

  return {
    binds: allBinds,
    dependentTables: [...dependentTables],
    sql,
  }
}

// --------------- 実行 ---------------

/**
 * GetIds ノードを実行し、NodeOutput を返す。
 */
export function executeGetIds(
  db: DbExec,
  node: GetIdsNode,
  upstreamOutputs: Map<string, NodeOutput>,
  limit?: number,
): {
  output: NodeOutput
  sql: string
  binds: BindValue[]
  dependentTables: string[]
} {
  const { sql, binds, dependentTables } = compileGetIds(
    node,
    upstreamOutputs,
    limit,
  )

  const rawRows = db.exec(sql, {
    bind: binds.length > 0 ? binds : undefined,
    returnValue: 'resultRows',
  })

  const outputTable = resolveOutputTable(
    node.table,
    node.outputIdColumn ?? 'id',
  )

  const rows: NodeOutputRow[] = rawRows.map((row) => ({
    createdAtMs: row[1] as number,
    id: row[0] as number,
    table: outputTable,
  }))

  const hash = `getids:${sql}:${JSON.stringify(binds)}:${rows.length}`

  return {
    binds,
    dependentTables,
    output: { hash, rows, sourceTable: outputTable },
    sql,
  }
}
