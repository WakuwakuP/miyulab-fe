// ============================================================
// Query IR — Source node SQL translator
// ============================================================

import { getDefaultTimeColumn } from '../completion'
import type { SourceNode } from '../nodes'
import type { JoinClause } from '../plan'

/** Standard table alias mapping */
export const TABLE_ALIASES: Record<string, string> = {
  notifications: 'n',
  posts: 'p',
}

/** Get the alias for a source table, defaulting to first letter */
export function getSourceAlias(table: string): string {
  return TABLE_ALIASES[table] ?? table[0]
}

/** Result of translating a source node */
export type SourceSql = {
  /** FROM clause: "table alias" */
  from: string
  /** The alias used for the source table */
  alias: string
  /** ORDER BY clause: "alias.column DIR" */
  orderBy: string
}

/**
 * Translate a SourceNode into FROM and ORDER BY SQL fragments.
 *
 * Example:
 *   { kind: 'source', table: 'posts' }
 *   → { from: 'posts p', alias: 'p', orderBy: 'p.created_at_ms DESC' }
 *
 *   { kind: 'source', table: 'notifications', orderBy: 'id', orderDirection: 'ASC' }
 *   → { from: 'notifications n', alias: 'n', orderBy: 'n.id ASC' }
 */
export function translateSource(source: SourceNode): SourceSql {
  const alias = getSourceAlias(source.table)
  const orderField =
    source.orderBy ?? getDefaultTimeColumn(source.table) ?? 'rowid'
  const orderDir = source.orderDirection ?? 'DESC'

  return {
    alias,
    from: `${source.table} ${alias}`,
    orderBy: `${alias}.${orderField} ${orderDir}`,
  }
}

/**
 * Build the JOIN clause string from an array of JoinClause objects.
 * Used when compiling the full Phase 1 SQL.
 */
export function buildJoinString(joins: JoinClause[]): string {
  return joins
    .map((j) => {
      const joinType = j.type === 'inner' ? 'INNER JOIN' : 'LEFT JOIN'
      return `${joinType} ${j.table} ${j.alias} ON ${j.on}`
    })
    .join(' ')
}
