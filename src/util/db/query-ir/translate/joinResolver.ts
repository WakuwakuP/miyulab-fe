// ============================================================
// Query IR — JOIN path resolver
// ============================================================

import type { TableDependency } from '../resolve'

export type JoinClauseResult = {
  /** FROM clause (table name or intermediate table with alias) */
  fromClause: string
  /** Additional INNER JOIN if via chain exists, null otherwise */
  finalJoin: string | null
  /** WHERE condition linking to the source table */
  whereClause: string
}

/**
 * Resolve a TableDependency's joinPath into SQL join clause components.
 * Handles both direct joins and via-chain (intermediate table) joins.
 *
 * Direct join example:
 *   post_stats.post_id = p.id
 *   → { fromClause: 'post_stats', finalJoin: null, whereClause: 'post_stats.post_id = p.id' }
 *
 * Via chain example (posts → post_hashtags → hashtags):
 *   → { fromClause: 'post_hashtags _via0',
 *       finalJoin: 'INNER JOIN hashtags ON hashtags.id = _via0.hashtag_id',
 *       whereClause: '_via0.post_id = p.id' }
 */
export function resolveJoinClause(
  dep: TableDependency,
  sourceAlias: string,
): JoinClauseResult {
  const joinPath = dep.joinPath
  if (!joinPath) {
    // No join path — direct table reference (e.g. source table itself)
    return { finalJoin: null, fromClause: dep.table, whereClause: '1=1' }
  }

  if (!joinPath.via || joinPath.via.length === 0) {
    // Direct join — no intermediate table
    return {
      finalJoin: null,
      fromClause: dep.table,
      whereClause: `${dep.table}.${joinPath.column} = ${sourceAlias}.${joinPath.sourceColumn}`,
    }
  }

  // Via chain — go through intermediate table(s)
  // Currently supports single-level via (1 intermediate table)
  const firstVia = joinPath.via[0]
  const viaAlias = '_via0'
  return {
    finalJoin: `INNER JOIN ${dep.table} ON ${dep.table}.${joinPath.column} = ${viaAlias}.${firstVia.toColumn}`,
    fromClause: `${firstVia.table} ${viaAlias}`,
    whereClause: `${viaAlias}.${firstVia.fromColumn} = ${sourceAlias}.${joinPath.sourceColumn}`,
  }
}
