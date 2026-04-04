// ============================================================
// Pattern recognizers — WHERE 条件 → FilterNode 変換
// ============================================================

import type { ExistsFilter, FilterNode, TableFilter } from '../nodes'

// ---------------------------------------------------------------------------
// Individual recognizers
// ---------------------------------------------------------------------------

/** ptt.timelineType = 'xxx' */
function tryTimelineFilter(cond: string): FilterNode | null {
  // Single: ptt.timelineType = 'home'
  const single = cond.match(/^ptt\.timeline(?:Type|_key)\s*=\s*'([^']+)'$/i)
  if (single) {
    return {
      kind: 'timeline-scope',
      timelineKeys: [single[1]],
    }
  }
  // Multiple: ptt.timelineType IN ('home', 'local')
  const multi = cond.match(/^ptt\.timeline(?:Type|_key)\s+IN\s*\(([^)]+)\)$/i)
  if (multi) {
    const keys = multi[1]
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''))
      .filter(Boolean)
    return { kind: 'timeline-scope', timelineKeys: keys }
  }
  return null
}

/** nt.name = 'xxx' or nt.name IN (...) */
function tryNotificationTypeFilter(cond: string): FilterNode | null {
  const single = cond.match(/^nt\.name\s*=\s*'([^']+)'$/i)
  if (single) {
    return {
      column: 'name',
      kind: 'table-filter',
      op: 'IN',
      table: 'notification_types',
      value: [single[1]],
    }
  }
  const multi = cond.match(/^nt\.name\s+IN\s*\(([^)]+)\)$/i)
  if (multi) {
    const types = multi[1]
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''))
      .filter(Boolean)
    return {
      column: 'name',
      kind: 'table-filter',
      op: 'IN',
      table: 'notification_types',
      value: types,
    }
  }
  return null
}

/** pr.acct = 'user@example.com' or ap.acct = '...' */
function tryAccountFilter(cond: string): FilterNode | null {
  // Include: pr.acct = 'xxx'
  const prMatch = cond.match(/^pr\.acct\s*=\s*'([^']+)'$/i)
  if (prMatch) {
    return {
      column: 'acct',
      kind: 'table-filter',
      op: 'IN',
      table: 'profiles',
      value: [prMatch[1]],
    }
  }
  // Notification actor: ap.acct = 'xxx'
  const apMatch = cond.match(/^ap\.acct\s*=\s*'([^']+)'$/i)
  if (apMatch) {
    return {
      column: 'acct',
      kind: 'table-filter',
      op: 'IN',
      table: 'profiles',
      value: [apMatch[1]],
    }
  }
  // IN: pr.acct IN ('a', 'b')
  const prInMatch = cond.match(/^pr\.acct\s+IN\s*\(([^)]+)\)$/i)
  if (prInMatch) {
    const accts = prInMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''))
      .filter(Boolean)
    return {
      column: 'acct',
      kind: 'table-filter',
      op: 'IN',
      table: 'profiles',
      value: accts,
    }
  }
  // W-1: NOT IN: pr.acct NOT IN ('a', 'b')
  const prNotInMatch = cond.match(/^pr\.acct\s+NOT\s+IN\s*\(([^)]+)\)$/i)
  if (prNotInMatch) {
    const accts = prNotInMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''))
      .filter(Boolean)
    return {
      column: 'acct',
      kind: 'table-filter',
      op: 'NOT IN',
      table: 'profiles',
      value: accts,
    }
  }
  return null
}

/** p.is_reblog = 0/1, p.is_sensitive = 0/1, p.spoiler_text = '', p.in_reply_to_uri IS NULL */
function tryPropertyFilter(cond: string): FilterNode | null {
  // p.column = value
  const eqMatch = cond.match(/^p\.(\w+)\s*=\s*('([^']*)'|(\d+))$/i)
  if (eqMatch) {
    const field = eqMatch[1]
    const value = eqMatch[3] !== undefined ? eqMatch[3] : Number(eqMatch[4])
    return {
      column: field,
      kind: 'table-filter',
      op: '=',
      table: 'posts',
      value,
    }
  }
  // p.column != value
  const neqMatch = cond.match(/^p\.(\w+)\s*!=\s*('([^']*)'|(\d+))$/i)
  if (neqMatch) {
    const field = neqMatch[1]
    const value = neqMatch[3] !== undefined ? neqMatch[3] : Number(neqMatch[4])
    return {
      column: field,
      kind: 'table-filter',
      op: '!=',
      table: 'posts',
      value,
    }
  }
  // p.column IS NULL
  const isNullMatch = cond.match(/^p\.(\w+)\s+IS\s+NULL$/i)
  if (isNullMatch) {
    return {
      column: isNullMatch[1],
      kind: 'table-filter',
      op: 'IS NULL',
      table: 'posts',
    }
  }
  // p.column IS NOT NULL
  const isNotNullMatch = cond.match(/^p\.(\w+)\s+IS\s+NOT\s+NULL$/i)
  if (isNotNullMatch) {
    return {
      column: isNotNullMatch[1],
      kind: 'table-filter',
      op: 'IS NOT NULL',
      table: 'posts',
    }
  }
  // p.language = 'ja' — already covered by p.column = 'value'
  // p.language IN ('ja', 'en')
  const langInMatch = cond.match(/^p\.(\w+)\s+IN\s*\(([^)]+)\)$/i)
  if (langInMatch) {
    const field = langInMatch[1]
    const values = langInMatch[2]
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''))
      .filter(Boolean)
    return {
      column: field,
      kind: 'table-filter',
      op: 'IN',
      table: 'posts',
      value: values,
    }
  }
  // W-1: p.column NOT IN ('a', 'b')
  const notInMatch = cond.match(/^p\.(\w+)\s+NOT\s+IN\s*\(([^)]+)\)$/i)
  if (notInMatch) {
    const field = notInMatch[1]
    const values = notInMatch[2]
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''))
      .filter(Boolean)
    return {
      column: field,
      kind: 'table-filter',
      op: 'NOT IN',
      table: 'posts',
      value: values,
    }
  }
  return null
}

/** vt.name = 'public' or vt.name IN (...) */
function tryVisibilityFilter(cond: string): FilterNode | null {
  const single = cond.match(/^vt\.name\s*=\s*'([^']+)'$/i)
  if (single) {
    return {
      column: 'name',
      kind: 'table-filter',
      op: 'IN',
      table: 'visibility_types',
      value: [single[1]],
    }
  }
  const multi = cond.match(/^vt\.name\s+IN\s*\(([^)]+)\)$/i)
  if (multi) {
    const types = multi[1]
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''))
      .filter(Boolean)
    return {
      column: 'name',
      kind: 'table-filter',
      op: 'IN',
      table: 'visibility_types',
      value: types,
    }
  }
  return null
}

/** ps.favourites_count >= 10 etc. */
function tryStatsFilter(cond: string): FilterNode | null {
  const match = cond.match(/^ps\.(\w+)\s*(>=|<=|>|<|=|!=)\s*(\d+)$/i)
  if (match) {
    return {
      column: match[1],
      kind: 'table-filter',
      op: match[2] as TableFilter['op'],
      table: 'post_stats',
      value: Number(match[3]),
    }
  }
  return null
}

/** ht.name = 'photo' or ht.name IN (...) */
function tryTagFilter(cond: string): FilterNode | null {
  const single = cond.match(/^ht\.name\s*=\s*'([^']+)'$/i)
  if (single) {
    return {
      column: 'name',
      kind: 'table-filter',
      op: 'IN',
      table: 'hashtags',
      value: [single[1]],
    }
  }
  const multi = cond.match(/^ht\.name\s+IN\s*\(([^)]+)\)$/i)
  if (multi) {
    const tags = multi[1]
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''))
      .filter(Boolean)
    return {
      column: 'name',
      kind: 'table-filter',
      op: 'IN',
      table: 'hashtags',
      value: tags,
    }
  }
  return null
}

/** W-4: EXISTS(SELECT 1 FROM <table> WHERE post_id = p.id) — ジェネリック */
function tryExistsFilter(cond: string): FilterNode | null {
  // EXISTS: EXISTS(SELECT 1 FROM <table> WHERE post_id = p.id)
  const existsMatch = cond.match(
    /^EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+(\w+)\s+WHERE\s+post_id\s*=\s*p\.id\s*\)$/i,
  )
  if (existsMatch) {
    return {
      kind: 'exists-filter',
      mode: 'exists',
      table: existsMatch[1],
    } satisfies ExistsFilter
  }
  // NOT EXISTS: NOT EXISTS(SELECT 1 FROM <table> WHERE post_id = p.id)
  const notExistsMatch = cond.match(
    /^NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+(\w+)\s+WHERE\s+post_id\s*=\s*p\.id\s*\)$/i,
  )
  if (notExistsMatch) {
    return {
      kind: 'exists-filter',
      mode: 'not-exists',
      table: notExistsMatch[1],
    } satisfies ExistsFilter
  }
  return null
}

/** W-4+W-6: (SELECT COUNT(*) FROM <table> WHERE post_id = p.id) <op> N — ジェネリック */
function tryCountFilter(cond: string): FilterNode | null {
  const match = cond.match(
    /^\(SELECT\s+COUNT\(\*\)\s+FROM\s+(\w+)\s+WHERE\s+post_id\s*=\s*p\.id\)\s*(>=|<=|=)\s*(\d+)$/i,
  )
  if (!match) return null

  const table = match[1]
  const op = match[2]
  const countValue = Number.parseInt(match[3], 10)

  let mode: 'count-gte' | 'count-lte' | 'count-eq'
  switch (op) {
    case '>=':
      mode = 'count-gte'
      break
    case '<=':
      mode = 'count-lte'
      break
    case '=':
      mode = 'count-eq'
      break
    default:
      return null
  }

  return {
    countValue,
    kind: 'exists-filter',
    mode,
    table,
  } satisfies ExistsFilter
}

/** pme.acct = 'user@example.com' (mention filter) */
function tryMentionFilter(cond: string): FilterNode | null {
  const single = cond.match(/^pme\.acct\s*=\s*'([^']+)'$/i)
  if (single) {
    return {
      column: 'acct',
      kind: 'table-filter',
      op: 'IN',
      table: 'post_mentions',
      value: [single[1]],
    }
  }
  const multi = cond.match(/^pme\.acct\s+IN\s*\(([^)]+)\)$/i)
  if (multi) {
    const accts = multi[1]
      .split(',')
      .map((s) => s.trim().replace(/'/g, ''))
      .filter(Boolean)
    return {
      column: 'acct',
      kind: 'table-filter',
      op: 'IN',
      table: 'post_mentions',
      value: accts,
    }
  }
  return null
}

/** pe.is_bookmarked = 1, pe.is_favourited = 1 etc. */
function tryInteractionFilter(cond: string): FilterNode | null {
  const match = cond.match(/^pe\.(is_\w+)\s*=\s*(\d+)$/i)
  if (match) {
    return {
      column: match[1],
      kind: 'table-filter',
      op: '=',
      table: 'post_interactions',
      value: Number(match[2]),
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Main recognizer
// ---------------------------------------------------------------------------

const RECOGNIZERS: ((cond: string) => FilterNode | null)[] = [
  tryTimelineFilter,
  tryNotificationTypeFilter,
  tryAccountFilter,
  tryVisibilityFilter,
  tryStatsFilter,
  tryTagFilter,
  tryExistsFilter,
  tryCountFilter,
  tryMentionFilter,
  tryInteractionFilter,
  tryPropertyFilter, // 最後: 汎用パターンなので他を優先
]

export function tryRecognize(condition: string): FilterNode | null {
  const trimmed = condition.trim()
  for (const recognizer of RECOGNIZERS) {
    const result = recognizer(trimmed)
    if (result) return result
  }
  return null
}
