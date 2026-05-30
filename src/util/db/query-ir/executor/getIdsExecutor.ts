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

type FilterCompileContext = {
  whereConditions: string[]
  allBinds: BindValue[]
  allJoins: JoinClause[]
  dependentTables: Set<string>
}

function resolveEffectiveTimeCol(
  alias: string,
  timeCol: string | null,
  tsjAlias: string | null,
  tsj: GetIdsNode['timeSourceJoin'],
): string | null {
  if (tsjAlias) {
    return `${tsjAlias}.${tsj?.timeColumn}`
  }
  if (timeCol != null) {
    return `${alias}.${timeCol}`
  }
  return null
}

function withUpstreamIds(
  filter: GetIdsFilter,
  upstreamOutputs: Map<string, NodeOutput>,
): GetIdsFilter {
  if (!('upstreamSourceNodeId' in filter) || !filter.upstreamSourceNodeId) {
    return filter
  }
  const upstream = upstreamOutputs.get(filter.upstreamSourceNodeId)
  if (upstream && upstream.rows.length > 0) {
    const ids = upstream.rows.map((r) => r.id)
    return { ...filter, value: ids }
  }
  // 上流が空: IN → 結果なし (空配列), NOT IN → 全パス (空配列)
  return { ...filter, value: [] }
}

function compileFilterIntoContext(
  filter: GetIdsFilter,
  table: string,
  alias: string,
  ctx: FilterCompileContext,
): string | null {
  const filterNode = getIdsFilterToFilterNode(filter)
  const compiled = compileFilterNode(filterNode, table, alias)
  ctx.allBinds.push(...compiled.binds)
  ctx.allJoins.push(...compiled.joins)
  ctx.dependentTables.add(filter.table)
  if (compiled.sql && compiled.sql !== '1=1') {
    return compiled.sql
  }
  return null
}

function joinSqlConditions(
  conditions: string[],
  operator: 'AND' | 'OR',
): string | null {
  if (conditions.length === 0) {
    return null
  }
  if (conditions.length === 1) {
    return conditions[0]
  }
  const joiner = operator === 'AND' ? ' AND ' : ' OR '
  return `(${conditions.join(joiner)})`
}

function compileRegularFilters(
  filters: GetIdsFilter[],
  table: string,
  alias: string,
  upstreamOutputs: Map<string, NodeOutput>,
  ctx: FilterCompileContext,
): void {
  for (const filter of filters) {
    const effectiveFilter = withUpstreamIds(filter, upstreamOutputs)
    const sql = compileFilterIntoContext(effectiveFilter, table, alias, ctx)
    if (sql) {
      ctx.whereConditions.push(sql)
    }
  }
}

function compileOrBranches(
  orBranches: GetIdsFilter[][],
  table: string,
  alias: string,
  ctx: FilterCompileContext,
): string | null {
  const branchSqls: string[] = []
  for (const branch of orBranches) {
    const branchConditions: string[] = []
    for (const filter of branch) {
      const sql = compileFilterIntoContext(filter, table, alias, ctx)
      if (sql) {
        branchConditions.push(sql)
      }
    }
    const branchSql = joinSqlConditions(branchConditions, 'AND')
    if (branchSql) {
      branchSqls.push(branchSql)
    }
  }
  return joinSqlConditions(branchSqls, 'OR')
}

function dedupeJoins(allJoins: JoinClause[]): JoinClause[] {
  const seenAliases = new Set<string>()
  return allJoins.filter((j) => {
    if (seenAliases.has(j.alias)) {
      return false
    }
    seenAliases.add(j.alias)
    return true
  })
}

function buildTimeJoinStr(
  tsj: NonNullable<GetIdsNode['timeSourceJoin']>,
  tsjAlias: string,
  alias: string,
): string {
  return `INNER JOIN ${tsj.table} ${tsjAlias} ON ${alias}.${tsj.localColumn} = ${tsjAlias}.${tsj.foreignColumn}`
}

function buildSelectSql(params: {
  alias: string
  idCol: string
  effectiveTimeCol: string | null
  table: string
  joinStr: string
  timeJoinStr: string
  whereStr: string
  groupByStr: string
  limitStr: string
}): string {
  const {
    alias,
    idCol,
    effectiveTimeCol,
    table,
    joinStr,
    timeJoinStr,
    whereStr,
    groupByStr,
    limitStr,
  } = params

  const selectTime = effectiveTimeCol
    ? `${effectiveTimeCol} AS created_at_ms`
    : '0 AS created_at_ms'
  const orderBy = effectiveTimeCol
    ? `ORDER BY ${effectiveTimeCol} DESC`
    : `ORDER BY ${alias}.rowid DESC`

  return [
    `SELECT ${alias}.${idCol} AS id, ${selectTime}`,
    `FROM ${table} ${alias}`,
    joinStr,
    timeJoinStr,
    whereStr,
    groupByStr,
    orderBy,
    limitStr,
  ]
    .filter(Boolean)
    .join(' ')
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

  const tsj = node.timeSourceJoin
  const tsjAlias = tsj ? '_time_src' : null
  const effectiveTimeCol = resolveEffectiveTimeCol(
    alias,
    timeCol,
    tsjAlias,
    tsj,
  )

  const ctx: FilterCompileContext = {
    allBinds: [],
    allJoins: [],
    dependentTables: new Set<string>([node.table]),
    whereConditions: [],
  }

  compileRegularFilters(node.filters, node.table, alias, upstreamOutputs, ctx)

  if (node.orBranches && node.orBranches.length > 0) {
    const orSql = compileOrBranches(node.orBranches, node.table, alias, ctx)
    if (orSql) {
      ctx.whereConditions.push(orSql)
    }
  }

  if (node.cursor) {
    const cursorPrefix = tsjAlias ?? alias
    ctx.whereConditions.push(
      `${cursorPrefix}.${node.cursor.column} ${node.cursor.op} ?`,
    )
    ctx.allBinds.push(node.cursor.value)
  }

  const uniqueJoins = dedupeJoins(ctx.allJoins)
  const needsGroupBy = uniqueJoins.some((j) => j.type === 'inner')

  let timeJoinStr = ''
  if (tsjAlias && tsj) {
    ctx.dependentTables.add(tsj.table)
    timeJoinStr = buildTimeJoinStr(tsj, tsjAlias, alias)
  }

  const joinStr = buildJoinString(uniqueJoins)
  const whereStr =
    ctx.whereConditions.length > 0
      ? `WHERE ${ctx.whereConditions.join(' AND ')}`
      : ''
  const groupByStr = needsGroupBy ? `GROUP BY ${alias}.${idCol}` : ''
  const limitStr = limit != null ? `LIMIT ${limit}` : ''

  const sql = buildSelectSql({
    alias,
    effectiveTimeCol,
    groupByStr,
    idCol,
    joinStr,
    limitStr,
    table: node.table,
    timeJoinStr,
    whereStr,
  })

  return {
    binds: ctx.allBinds,
    dependentTables: [...ctx.dependentTables],
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
