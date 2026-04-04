// ============================================================
// Graph Executor — LookupRelated ノードエグゼキュータ
//
// 上流ノードの出力 ID リストから関連テーブルの ID を相関検索する。
// joinConditions, timeCondition, aggregate に基づいて SQL を生成する。
//
// timeCondition がある場合は JOIN ベースのクエリを生成し、
// 各入力行に対して個別に時間窓を適用する（per-row 相関）。
//
// resolveIdentity が有効な joinCondition では、
// canonical acct (acct@host) による同一人物解決 CTE を生成する。
// ============================================================

import type { DbExec } from '../../sqlite/queries/executionEngine'
import { getDefaultTimeColumn, resolveOutputTable } from '../completion'
import type { BindValue, LookupRelatedNode } from '../nodes'
import type { NodeOutputRow } from '../plan'
import type { NodeOutput } from './types'

// --------------- Identity Resolution CTE ---------------

/**
 * canonical acct を算出する CTE 定義。
 * profiles.acct に '@' を含む場合はそのまま使用し、
 * 含まない場合は acct || '@' || servers.host で正規化する。
 */
const CANONICAL_CTE =
  '_ri_canonical AS (' +
  'SELECT id, ' +
  "CASE WHEN acct LIKE '%@%' THEN acct " +
  "ELSE acct || '@' || (SELECT host FROM servers WHERE id = server_id) " +
  'END AS canonical_acct ' +
  'FROM profiles)'

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

  // timeCondition がありかつ resolve を使わない場合は JOIN ベースで per-row 相関
  const hasResolve = node.joinConditions.some((jc) => jc.resolve)
  if (node.timeCondition && !hasResolve) {
    return executeWithJoin(db, node, input)
  }

  // それ以外は IN ベース（timeCondition なし、または resolve 使用時）
  return executeWithIn(db, node, input)
}

// --------------- JOIN ベース（per-row 相関） ---------------

/**
 * JOIN ベースの実行。
 * 上流テーブルと lookup テーブルを JOIN し、
 * 各入力行に対して個別に時間窓を適用する。
 *
 * resolveIdentity が有効な joinCondition がある場合、
 * canonical acct CTE + identity_map CTE を生成して alias を展開する。
 */
function executeWithJoin(
  db: DbExec,
  node: LookupRelatedNode,
  input: NodeOutput,
): {
  output: NodeOutput
  sql: string
  binds: BindValue[]
  dependentTables: string[]
} {
  const lt = 'lt'
  const src = 'src'
  // biome-ignore lint/style/noNonNullAssertion: caller guarantees timeCondition exists
  const tc = node.timeCondition!
  const binds: BindValue[] = []
  const dependentTables = [node.lookupTable, input.sourceTable]

  const ids = input.rows.map((r) => r.id)
  const placeholders = ids.map(() => '?').join(', ')

  const hasIdentityResolve = node.joinConditions.some(
    (jc) => jc.resolveIdentity,
  )

  // --- Identity resolution CTE ---
  let ctePrefix = ''
  const extraJoinStrs: string[] = []

  if (hasIdentityResolve) {
    dependentTables.push('profiles', 'servers')
    const cteParts: string[] = [CANONICAL_CTE]

    let riIdx = 0
    for (const jc of node.joinConditions) {
      if (!jc.resolveIdentity) continue
      const mapAlias = `_ri${riIdx}`
      const inputCol =
        jc.inputColumn && jc.inputColumn !== 'id' ? jc.inputColumn : 'id'

      cteParts.push(
        `${mapAlias} AS (` +
          'SELECT c1.id AS src_id, c2.id AS alias_id ' +
          'FROM _ri_canonical c1 ' +
          'JOIN _ri_canonical c2 ON c1.canonical_acct = c2.canonical_acct ' +
          `WHERE c1.id IN (` +
          `SELECT DISTINCT ${inputCol} FROM ${input.sourceTable} WHERE id IN (${placeholders})` +
          '))',
      )
      binds.push(...ids)

      extraJoinStrs.push(
        `JOIN ${mapAlias} ON ${mapAlias}.alias_id = ${lt}.${jc.lookupColumn}`,
      )
      riIdx++
    }

    ctePrefix = `WITH ${cteParts.join(', ')} `
  }

  // --- JOIN ON 条件 ---
  const joinOns: string[] = []
  let riIdx2 = 0
  for (const jc of node.joinConditions) {
    if (jc.resolveIdentity) {
      const mapAlias = `_ri${riIdx2}`
      const inputCol =
        jc.inputColumn && jc.inputColumn !== 'id' ? jc.inputColumn : 'id'
      joinOns.push(`${src}.${inputCol} = ${mapAlias}.src_id`)
      riIdx2++
    } else if (jc.inputColumn && jc.inputColumn !== 'id') {
      joinOns.push(`${src}.${jc.inputColumn} = ${lt}.${jc.lookupColumn}`)
    } else {
      joinOns.push(`${src}.id = ${lt}.${jc.lookupColumn}`)
    }
  }

  // --- WHERE 条件 ---
  const conditions: string[] = []
  conditions.push(`${src}.id IN (${placeholders})`)
  binds.push(...ids)

  // per-row 時間条件
  if (tc.afterInput) {
    conditions.push(
      `${lt}.${tc.lookupTimeColumn} > ${src}.${tc.inputTimeColumn}`,
    )
    conditions.push(
      `${lt}.${tc.lookupTimeColumn} <= ${src}.${tc.inputTimeColumn} + ${tc.windowMs}`,
    )
  } else {
    conditions.push(
      `${lt}.${tc.lookupTimeColumn} < ${src}.${tc.inputTimeColumn}`,
    )
    conditions.push(
      `${lt}.${tc.lookupTimeColumn} >= ${src}.${tc.inputTimeColumn} - ${tc.windowMs}`,
    )
  }

  // --- SELECT 句構築 ---
  let selectExpr: string
  let groupByStr = ''

  if (node.aggregate) {
    selectExpr = `${lt}.id AS id, ${node.aggregate.function}(${lt}.${node.aggregate.column}) AS created_at_ms`
    groupByStr = `GROUP BY ${lt}.id`
  } else {
    const defaultTimeCol = getDefaultTimeColumn(node.lookupTable)
    selectExpr = defaultTimeCol
      ? `${lt}.id AS id, ${lt}.${defaultTimeCol} AS created_at_ms`
      : `${lt}.id AS id, 0 AS created_at_ms`
  }

  const joinStr = `JOIN ${input.sourceTable} ${src} ON ${joinOns.join(' AND ')}`
  const whereStr = `WHERE ${conditions.join(' AND ')}`

  const sql = [
    `${ctePrefix}SELECT DISTINCT ${selectExpr}`,
    `FROM ${node.lookupTable} ${lt}`,
    ...extraJoinStrs,
    joinStr,
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

// --------------- IN ベース（timeCondition なし or resolve） ---------------

/**
 * IN ベースの実行。
 * timeCondition がない場合、または resolve がある場合に使用する。
 * resolve 使用時の timeCondition はグローバル min/max で近似する。
 *
 * resolveIdentity が有効な joinCondition では、
 * canonical acct サブクエリで alias profile ID を展開する。
 */
function executeWithIn(
  db: DbExec,
  node: LookupRelatedNode,
  input: NodeOutput,
): {
  output: NodeOutput
  sql: string
  binds: BindValue[]
  dependentTables: string[]
} {
  const lt = 'lt'
  const binds: BindValue[] = []
  const conditions: string[] = []
  const dependentTables = [node.lookupTable, input.sourceTable]

  const hasIdentityResolve = node.joinConditions.some(
    (jc) => jc.resolveIdentity,
  )
  let ctePrefix = ''

  if (hasIdentityResolve) {
    dependentTables.push('profiles', 'servers')
    ctePrefix = `WITH ${CANONICAL_CTE} `
  }

  // --- JOIN 条件: 上流 IDs を IN 句で注入 ---
  for (const jc of node.joinConditions) {
    const ids = input.rows.map((r) => r.id)
    const placeholders = ids.map(() => '?').join(', ')

    if (jc.resolveIdentity) {
      // canonical acct による同一人物解決
      const inputCol =
        jc.inputColumn && jc.inputColumn !== 'id' ? jc.inputColumn : 'id'
      conditions.push(
        `${lt}.${jc.lookupColumn} IN (` +
          'SELECT c2.id FROM _ri_canonical c2 ' +
          'WHERE c2.canonical_acct IN (' +
          'SELECT c1.canonical_acct FROM _ri_canonical c1 ' +
          `WHERE c1.id IN (SELECT DISTINCT ${inputCol} FROM ${input.sourceTable} WHERE id IN (${placeholders}))` +
          '))',
      )
      binds.push(...ids)
    } else if (jc.resolve) {
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

  // --- 時間条件 (グローバル min/max 近似 — resolve 使用時のフォールバック) ---
  if (node.timeCondition) {
    const tc = node.timeCondition
    const minTime = Math.min(...input.rows.map((r) => r.createdAtMs))
    const maxTime = Math.max(...input.rows.map((r) => r.createdAtMs))

    if (tc.afterInput) {
      conditions.push(`${lt}.${tc.lookupTimeColumn} > ?`)
      binds.push(minTime)
      conditions.push(`${lt}.${tc.lookupTimeColumn} <= ?`)
      binds.push(maxTime + tc.windowMs)
    } else {
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
    `${ctePrefix}SELECT ${selectExpr}`,
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
