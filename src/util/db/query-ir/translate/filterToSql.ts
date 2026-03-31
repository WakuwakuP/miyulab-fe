// ============================================================
// Query IR — Filter node → SQL translator
// ============================================================

import type {
  AerialReplyFilter,
  BackendFilter,
  BindValue,
  ExistsFilter,
  FilterNode,
  FilterOp,
  FilterValue,
  ModerationFilter,
  OrGroup,
  TableFilter,
  TimelineScope,
} from '../nodes'
import type { CompiledFilter, JoinClause } from '../plan'
import { TABLE_REGISTRY } from '../registry'
import type { TableDependency } from '../resolve'
import { resolveTableDependency } from '../resolve'
import { resolveJoinClause } from './joinResolver'

// --------------- Condition formatting ---------------

/** Convert a column expression + operator + value into a SQL fragment with bind params */
export function formatCondition(
  columnExpr: string,
  op: FilterOp,
  value: FilterValue | undefined,
): { sql: string; binds: BindValue[] } {
  switch (op) {
    case 'IS NULL':
      return { binds: [], sql: `${columnExpr} IS NULL` }
    case 'IS NOT NULL':
      return { binds: [], sql: `${columnExpr} IS NOT NULL` }
    case 'IN':
    case 'NOT IN': {
      const arr = Array.isArray(value) ? value : []
      if (arr.length === 0) {
        // IN with empty set → always false; NOT IN → always true
        return op === 'IN' ? { binds: [], sql: '0' } : { binds: [], sql: '1' }
      }
      const placeholders = arr.map(() => '?').join(', ')
      return {
        binds: arr,
        sql: `${columnExpr} ${op} (${placeholders})`,
      }
    }
    default: {
      const bind: BindValue = Array.isArray(value)
        ? (value[0] ?? null)
        : (value ?? null)
      return { binds: [bind], sql: `${columnExpr} ${op} ?` }
    }
  }
}

// --------------- Strategy-specific translators ---------------

/** Translate a table-filter on the source table itself (strategy = 'direct') */
export function translateDirectCondition(
  node: TableFilter,
  sourceAlias: string,
): CompiledFilter {
  const columnExpr = `${sourceAlias}.${node.column}`
  const { sql, binds } = formatCondition(columnExpr, node.op, node.value)
  return { binds, joins: [], sql }
}

/** Translate using EXISTS / NOT EXISTS / COUNT subquery */
export function translateExistsCondition(
  node: TableFilter | ExistsFilter,
  dep: TableDependency,
  sourceAlias: string,
): CompiledFilter {
  const { fromClause, finalJoin, whereClause } = resolveJoinClause(
    dep,
    sourceAlias,
  )
  const joinPart = finalJoin ? ` ${finalJoin}` : ''
  const allBinds: BindValue[] = []

  if (node.kind === 'exists-filter') {
    const innerConditions: string[] = []
    if (node.innerFilters) {
      for (const inner of node.innerFilters) {
        const colExpr = `${dep.table}.${inner.column}`
        const { sql, binds } = formatCondition(colExpr, inner.op, inner.value)
        innerConditions.push(sql)
        allBinds.push(...binds)
      }
    }
    const innerWhere =
      innerConditions.length > 0 ? ` AND ${innerConditions.join(' AND ')}` : ''

    switch (node.mode) {
      case 'exists':
        return {
          binds: allBinds,
          joins: [],
          sql: `EXISTS (SELECT 1 FROM ${fromClause}${joinPart} WHERE ${whereClause}${innerWhere})`,
        }
      case 'not-exists':
        return {
          binds: allBinds,
          joins: [],
          sql: `NOT EXISTS (SELECT 1 FROM ${fromClause}${joinPart} WHERE ${whereClause}${innerWhere})`,
        }
      case 'count-gte':
        return {
          binds: [...allBinds, node.countValue ?? 1],
          joins: [],
          sql: `(SELECT COUNT(*) FROM ${fromClause}${joinPart} WHERE ${whereClause}${innerWhere}) >= ?`,
        }
      case 'count-lte':
        return {
          binds: [...allBinds, node.countValue ?? 0],
          joins: [],
          sql: `(SELECT COUNT(*) FROM ${fromClause}${joinPart} WHERE ${whereClause}${innerWhere}) <= ?`,
        }
      case 'count-eq':
        return {
          binds: [...allBinds, node.countValue ?? 0],
          joins: [],
          sql: `(SELECT COUNT(*) FROM ${fromClause}${joinPart} WHERE ${whereClause}${innerWhere}) = ?`,
        }
    }
  }

  // TableFilter with exists strategy
  const colExpr = `${dep.table}.${node.column}`
  const { sql: condSql, binds: condBinds } = formatCondition(
    colExpr,
    node.op,
    node.value,
  )
  return {
    binds: condBinds,
    joins: [],
    sql: `EXISTS (SELECT 1 FROM ${fromClause}${joinPart} WHERE ${whereClause} AND ${condSql})`,
  }
}

/** Translate using NOT EXISTS subquery */
export function translateNotExistsCondition(
  node: TableFilter | ExistsFilter,
  dep: TableDependency,
  sourceAlias: string,
): CompiledFilter {
  const { fromClause, finalJoin, whereClause } = resolveJoinClause(
    dep,
    sourceAlias,
  )
  const joinPart = finalJoin ? ` ${finalJoin}` : ''
  const allBinds: BindValue[] = []
  const conditions: string[] = []

  if (node.kind === 'exists-filter' && node.innerFilters) {
    for (const inner of node.innerFilters) {
      const colExpr = `${dep.table}.${inner.column}`
      const { sql, binds } = formatCondition(colExpr, inner.op, inner.value)
      conditions.push(sql)
      allBinds.push(...binds)
    }
  } else if (node.kind === 'table-filter') {
    const colExpr = `${dep.table}.${node.column}`
    const { sql, binds } = formatCondition(colExpr, node.op, node.value)
    conditions.push(sql)
    allBinds.push(...binds)
  }

  const extraWhere =
    conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : ''

  return {
    binds: allBinds,
    joins: [],
    sql: `NOT EXISTS (SELECT 1 FROM ${fromClause}${joinPart} WHERE ${whereClause}${extraWhere})`,
  }
}

/** Translate using a scalar subquery */
export function translateScalarSubquery(
  node: TableFilter,
  dep: TableDependency,
  sourceAlias: string,
): CompiledFilter {
  if (!dep.joinPath) {
    return translateDirectCondition(node, sourceAlias)
  }

  const subquery = `(SELECT ${node.column} FROM ${dep.table} WHERE ${dep.joinPath.column} = ${sourceAlias}.${dep.joinPath.sourceColumn})`
  const { sql, binds } = formatCondition(subquery, node.op, node.value)
  return { binds, joins: [], sql }
}

/** Translate using an INNER JOIN with WHERE condition */
export function translateInnerJoin(
  node: TableFilter | ExistsFilter,
  dep: TableDependency,
  sourceAlias: string,
): CompiledFilter {
  const joinPath = dep.joinPath
  if (!joinPath) {
    if (node.kind === 'table-filter') {
      return translateDirectCondition(node, sourceAlias)
    }
    return { binds: [], joins: [], sql: '1=1' }
  }

  // Build short alias from table name (e.g. 'timeline_entries' → 'te')
  const parts = dep.table.split('_')
  let alias =
    parts.length > 1
      ? parts.map((w) => w[0]).join('')
      : dep.table.substring(0, 2)
  if (alias === sourceAlias) {
    alias = `${alias}0`
  }

  const joinClause: JoinClause = {
    alias,
    on: `${alias}.${joinPath.column} = ${sourceAlias}.${joinPath.sourceColumn}`,
    table: dep.table,
    type: 'inner',
  }

  if (node.kind === 'table-filter') {
    const colExpr = `${alias}.${node.column}`
    const { sql, binds } = formatCondition(colExpr, node.op, node.value)
    return { binds, joins: [joinClause], sql }
  }

  // ExistsFilter with inner-join strategy
  const allBinds: BindValue[] = []
  const innerConditions: string[] = []
  if (node.innerFilters) {
    for (const inner of node.innerFilters) {
      const colExpr = `${alias}.${inner.column}`
      const { sql, binds } = formatCondition(colExpr, inner.op, inner.value)
      innerConditions.push(sql)
      allBinds.push(...binds)
    }
  }

  return {
    binds: allBinds,
    joins: [joinClause],
    sql: innerConditions.length > 0 ? innerConditions.join(' AND ') : '1=1',
  }
}

// --------------- Semantic filter compilers ---------------

/** Compile a BackendFilter into an EXISTS subquery on post_backend_ids */
export function compileBackendFilter(
  node: BackendFilter,
  sourceAlias: string,
): CompiledFilter {
  const placeholders = node.localAccountIds.map(() => '?').join(', ')
  return {
    binds: node.localAccountIds,
    joins: [],
    sql: `EXISTS (SELECT 1 FROM post_backend_ids pbi WHERE pbi.post_id = ${sourceAlias}.id AND pbi.local_account_id IN (${placeholders}))`,
  }
}

/** Compile a ModerationFilter using profiles join path for mute / instance-block */
export function compileModerationFilter(
  node: ModerationFilter,
  sourceAlias: string,
  sourceTable: string,
): CompiledFilter {
  const profileEntry = TABLE_REGISTRY.profiles
  if (!profileEntry) {
    return { binds: [], joins: [], sql: '1=1' }
  }
  const profileJoinPath =
    profileEntry.joinPaths[sourceTable as keyof typeof profileEntry.joinPaths]
  if (!profileJoinPath) {
    return { binds: [], joins: [], sql: '1=1' }
  }

  const profileFk = `${sourceAlias}.${profileJoinPath.sourceColumn}`
  const conditions: string[] = []
  const allBinds: BindValue[] = []

  for (const apply of node.apply) {
    if (apply === 'mute') {
      if (node.serverIds && node.serverIds.length > 0) {
        const serverPlaceholders = node.serverIds.map(() => '?').join(', ')
        conditions.push(
          `${profileFk} NOT IN (SELECT p2.id FROM profiles p2 INNER JOIN muted_accounts ma ON ma.account_acct = p2.acct WHERE ma.server_id IN (${serverPlaceholders}))`,
        )
        allBinds.push(...node.serverIds)
      } else {
        conditions.push(
          `${profileFk} NOT IN (SELECT p2.id FROM profiles p2 INNER JOIN muted_accounts ma ON ma.account_acct = p2.acct)`,
        )
      }
    } else if (apply === 'instance-block') {
      conditions.push(
        `NOT EXISTS (SELECT 1 FROM blocked_instances bi WHERE bi.instance_domain = (SELECT s.host FROM servers s INNER JOIN profiles p2 ON p2.server_id = s.id WHERE p2.id = ${profileFk}))`,
      )
    }
  }

  return {
    binds: allBinds,
    joins: [],
    sql: conditions.length > 0 ? conditions.join(' AND ') : '1=1',
  }
}

/** Compile a TimelineScope into an INNER JOIN on timeline_entries */
export function compileTimelineScope(
  node: TimelineScope,
  sourceAlias: string,
): CompiledFilter {
  const join: JoinClause = {
    alias: 'te',
    on: `te.post_id = ${sourceAlias}.id`,
    table: 'timeline_entries',
    type: 'inner',
  }

  const conditions: string[] = []
  const allBinds: BindValue[] = []

  if (node.timelineKeys.length === 1) {
    conditions.push('te.timeline_key = ?')
    allBinds.push(node.timelineKeys[0])
  } else if (node.timelineKeys.length > 1) {
    const placeholders = node.timelineKeys.map(() => '?').join(', ')
    conditions.push(`te.timeline_key IN (${placeholders})`)
    allBinds.push(...node.timelineKeys)
  }

  if (node.accountScope && node.accountScope.length > 0) {
    if (node.accountScope.length === 1) {
      conditions.push('te.local_account_id = ?')
      allBinds.push(node.accountScope[0])
    } else {
      const placeholders = node.accountScope.map(() => '?').join(', ')
      conditions.push(`te.local_account_id IN (${placeholders})`)
      allBinds.push(...node.accountScope)
    }
  }

  return {
    binds: allBinds,
    joins: [join],
    sql: conditions.length > 0 ? conditions.join(' AND ') : '1=1',
  }
}

/** Compile an OrGroup into a parenthesized OR expression */
export function compileOrGroup(
  node: OrGroup,
  sourceTable: string,
  sourceAlias: string,
): CompiledFilter {
  const allJoins: JoinClause[] = []
  const allBinds: BindValue[] = []
  const branchSqls: string[] = []

  for (const branch of node.branches) {
    const branchConditions: string[] = []
    for (const filter of branch) {
      const compiled = compileFilterNode(filter, sourceTable, sourceAlias)
      if (compiled.sql && compiled.sql !== '1=1') {
        branchConditions.push(compiled.sql)
      }
      allBinds.push(...compiled.binds)
      allJoins.push(...compiled.joins)
    }
    if (branchConditions.length > 0) {
      branchSqls.push(
        branchConditions.length === 1
          ? branchConditions[0]
          : `(${branchConditions.join(' AND ')})`,
      )
    }
  }

  const sql =
    branchSqls.length === 0
      ? '1=1'
      : branchSqls.length === 1
        ? branchSqls[0]
        : `(${branchSqls.join(' OR ')})`

  return { binds: allBinds, joins: allJoins, sql }
}

// --------------- Main dispatcher ---------------

/** Compile an AerialReplyFilter into a correlated EXISTS subquery */
export function compileAerialReplyFilter(
  node: AerialReplyFilter,
  sourceAlias: string,
): CompiledFilter {
  const typePlaceholders = node.notificationTypes.map(() => '?').join(', ')

  // 通知直後（timeWindowMs以内）に同一人物が最初に投稿したものを検出
  const sql = [
    `EXISTS (SELECT 1 FROM notifications ntf`,
    `INNER JOIN notification_types ntt ON ntt.id = ntf.notification_type_id`,
    `INNER JOIN profiles pra ON pra.id = ntf.actor_profile_id`,
    `WHERE ntt.name IN (${typePlaceholders})`,
    `AND pra.acct = (SELECT acct FROM profiles WHERE id = ${sourceAlias}.author_profile_id)`,
    `AND ${sourceAlias}.created_at_ms > ntf.created_at_ms`,
    `AND ${sourceAlias}.created_at_ms <= ntf.created_at_ms + ?`,
    `AND ${sourceAlias}.created_at_ms = (`,
    `SELECT MIN(p2.created_at_ms) FROM posts p2`,
    `WHERE p2.author_profile_id = ${sourceAlias}.author_profile_id`,
    `AND p2.created_at_ms > ntf.created_at_ms`,
    `AND p2.created_at_ms <= ntf.created_at_ms + ?))`,
  ].join(' ')

  return {
    binds: [...node.notificationTypes, node.timeWindowMs, node.timeWindowMs],
    joins: [],
    sql,
  }
}

/** Compile any FilterNode into a SQL WHERE clause fragment */
export function compileFilterNode(
  node: FilterNode,
  sourceTable: string,
  sourceAlias: string,
): CompiledFilter {
  switch (node.kind) {
    case 'table-filter':
    case 'exists-filter': {
      const deps = resolveTableDependency(node, sourceTable)
      if (deps.length === 0) {
        return { binds: [], joins: [], sql: '1=1' }
      }
      const dep = deps[0]
      switch (dep.strategy) {
        case 'direct':
          if (node.kind === 'table-filter') {
            return translateDirectCondition(node, sourceAlias)
          }
          return translateExistsCondition(node, dep, sourceAlias)
        case 'exists':
          return translateExistsCondition(node, dep, sourceAlias)
        case 'not-exists':
          return translateNotExistsCondition(node, dep, sourceAlias)
        case 'scalar-subquery':
          if (node.kind === 'table-filter') {
            return translateScalarSubquery(node, dep, sourceAlias)
          }
          return translateExistsCondition(node, dep, sourceAlias)
        case 'inner-join':
          return translateInnerJoin(node, dep, sourceAlias)
      }
      break
    }
    case 'backend-filter':
      return compileBackendFilter(node, sourceAlias)
    case 'moderation-filter':
      return compileModerationFilter(node, sourceAlias, sourceTable)
    case 'timeline-scope':
      return compileTimelineScope(node, sourceAlias)
    case 'or-group':
      return compileOrGroup(node, sourceTable, sourceAlias)
    case 'raw-sql-filter':
      return { binds: [], joins: [], sql: node.where }
    case 'aerial-reply-filter':
      return compileAerialReplyFilter(node, sourceAlias)
  }
}
