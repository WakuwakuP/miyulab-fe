// ============================================================
// nodesToWhere — IR ノード → WHERE 句テキスト逆変換
// ============================================================
//
// ノードモード → テキストモードへの切り替え時に使用する。
// parseWhereToNodes() の逆操作。

import type {
  AerialReplyFilter,
  ExistsFilter,
  FilterNode,
  RawSQLFilter,
  TableFilter,
  TimelineScope,
} from '../nodes'

// ---------------------------------------------------------------------------
// Table alias mapping (IR table name → SQL alias)
// ---------------------------------------------------------------------------

const TABLE_TO_ALIAS: Record<string, string> = {
  hashtags: 'ht',
  notification_types: 'nt',
  post_interactions: 'pe',
  post_media: 'post_media',
  post_mentions: 'pme',
  post_stats: 'ps',
  posts: 'p',
  profiles: 'pr',
  visibility_types: 'vt',
}

// ---------------------------------------------------------------------------
// Individual node → SQL converters
// ---------------------------------------------------------------------------

function timelineScopeToSql(node: TimelineScope): string {
  if (node.timelineKeys.length === 1) {
    return `ptt.timelineType = '${node.timelineKeys[0]}'`
  }
  const keys = node.timelineKeys.map((k) => `'${k}'`).join(', ')
  return `ptt.timelineType IN (${keys})`
}

function tableFilterToSql(node: TableFilter): string {
  const alias = TABLE_TO_ALIAS[node.table] ?? node.table
  const col = `${alias}.${node.column}`

  switch (node.op) {
    case 'IS NULL':
      return `${col} IS NULL`
    case 'IS NOT NULL':
      return `${col} IS NOT NULL`
    case 'IN':
    case 'NOT IN': {
      if (Array.isArray(node.value)) {
        const values = node.value
          .map((v) => (typeof v === 'string' ? `'${v}'` : String(v)))
          .join(', ')
        return `${col} ${node.op} (${values})`
      }
      if (typeof node.value === 'string') {
        return `${col} ${node.op === 'IN' ? '=' : '!='} '${node.value}'`
      }
      return `${col} ${node.op === 'IN' ? '=' : '!='} ${node.value}`
    }
    default: {
      if (typeof node.value === 'string') {
        return `${col} ${node.op} '${node.value}'`
      }
      return `${col} ${node.op} ${node.value}`
    }
  }
}

function existsFilterToSql(node: ExistsFilter): string {
  switch (node.mode) {
    case 'exists':
      return `EXISTS(SELECT 1 FROM ${node.table} WHERE post_id = p.id)`
    case 'not-exists':
      return `NOT EXISTS(SELECT 1 FROM ${node.table} WHERE post_id = p.id)`
    case 'count-gte':
      return `(SELECT COUNT(*) FROM ${node.table} WHERE post_id = p.id) >= ${node.countValue ?? 1}`
    case 'count-lte':
      return `(SELECT COUNT(*) FROM ${node.table} WHERE post_id = p.id) <= ${node.countValue ?? 0}`
    case 'count-eq':
      return `(SELECT COUNT(*) FROM ${node.table} WHERE post_id = p.id) = ${node.countValue ?? 0}`
  }
}

function rawSqlFilterToSql(node: RawSQLFilter): string {
  return node.where
}

function aerialReplyFilterToSql(node: AerialReplyFilter): string {
  const types = node.notificationTypes.map((t) => `'${t}'`).join(', ')
  return [
    `EXISTS(SELECT 1 FROM notifications ntf`,
    `INNER JOIN notification_types ntt ON ntt.id = ntf.notification_type_id`,
    `INNER JOIN profiles pra ON pra.id = ntf.actor_profile_id`,
    `WHERE ntt.name IN (${types})`,
    `AND pra.acct = (SELECT acct FROM profiles WHERE id = p.author_profile_id)`,
    `AND p.created_at_ms > ntf.created_at_ms`,
    `AND p.created_at_ms <= ntf.created_at_ms + ${node.timeWindowMs}`,
    `AND p.created_at_ms = (SELECT MIN(p2.created_at_ms) FROM posts p2`,
    `WHERE p2.author_profile_id = p.author_profile_id`,
    `AND p2.created_at_ms > ntf.created_at_ms`,
    `AND p2.created_at_ms <= ntf.created_at_ms + ${node.timeWindowMs}))`,
  ].join(' ')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * FilterNode の配列を WHERE 句テキストに変換する。
 * 各ノードは AND で結合される。
 */
export function nodesToWhere(nodes: FilterNode[]): string {
  const conditions: string[] = []

  for (const node of nodes) {
    switch (node.kind) {
      case 'timeline-scope':
        conditions.push(timelineScopeToSql(node))
        break
      case 'table-filter':
        conditions.push(tableFilterToSql(node))
        break
      case 'exists-filter':
        conditions.push(existsFilterToSql(node))
        break
      case 'raw-sql-filter':
        conditions.push(rawSqlFilterToSql(node))
        break
      case 'aerial-reply-filter':
        conditions.push(aerialReplyFilterToSql(node))
        break
      case 'or-group': {
        const branchSqls: string[] = []
        for (const branch of node.branches) {
          const branchWhere = nodesToWhere(branch)
          if (branchWhere) {
            branchSqls.push(
              branch.length > 1 ? `(${branchWhere})` : branchWhere,
            )
          }
        }
        if (branchSqls.length > 0) {
          conditions.push(
            branchSqls.length === 1
              ? branchSqls[0]
              : `(${branchSqls.join(' OR ')})`,
          )
        }
        break
      }
      case 'backend-filter':
        // BackendFilter はユーザーが書くフィルタではないためスキップ
        break
      case 'moderation-filter':
        // ModerationFilter は内部フィルタのためスキップ
        break
    }
  }

  return conditions.join(' AND ')
}

/**
 * FilterNode 単体を WHERE 句の条件文字列に変換する。
 * ノードカードのプレビュー表示用。
 */
export function nodeToSqlFragment(node: FilterNode): string {
  switch (node.kind) {
    case 'timeline-scope':
      return timelineScopeToSql(node)
    case 'table-filter':
      return tableFilterToSql(node)
    case 'exists-filter':
      return existsFilterToSql(node)
    case 'raw-sql-filter':
      return rawSqlFilterToSql(node)
    case 'aerial-reply-filter':
      return aerialReplyFilterToSql(node)
    case 'or-group': {
      const branchSqls: string[] = []
      for (const branch of node.branches) {
        const branchWhere = nodesToWhere(branch)
        if (branchWhere) {
          branchSqls.push(branch.length > 1 ? `(${branchWhere})` : branchWhere)
        }
      }
      if (branchSqls.length === 0) return '(empty OR group)'
      return branchSqls.length === 1
        ? branchSqls[0]
        : `(${branchSqls.join(' OR ')})`
    }
    case 'backend-filter':
      return `backend_filter(${node.localAccountIds.join(', ')})`
    case 'moderation-filter':
      return `moderation(${node.apply.join(', ')})`
  }
}
