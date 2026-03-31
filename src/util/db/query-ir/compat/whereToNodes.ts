// ============================================================
// whereToNodes — WHERE 句テキスト → IR ノード変換パーサ
// ============================================================
//
// ユーザーが入力した Advanced Query の WHERE 句テキストを
// 認識可能なパターンは IR ノードに、認識不能な部分は
// RawSQLFilter にフォールバックする。

import type {
  ExistsFilter,
  FilterNode,
  QueryPlan,
  RawSQLFilter,
  TableFilter,
} from '../nodes'
import { rewriteLegacyAliases } from './legacyAliases'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ParseResult = {
  /** 認識できたノード */
  nodes: FilterNode[]
  /** 認識できなかった残余 WHERE (null = 全て認識済み) */
  remainingWhere: string | null
}

/** クエリモード判定結果 */
export type QueryMode = 'status' | 'notification' | 'mixed'

// ---------------------------------------------------------------------------
// Top-level AND splitter
// ---------------------------------------------------------------------------

/**
 * 括弧のネストレベルを追跡して、トップレベルの AND で分割する。
 * 文字列リテラル内の AND は無視する。
 */
export function splitByTopLevelAnd(where: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  let inString = false

  for (let i = 0; i < where.length; i++) {
    const ch = where[i]

    // シングルクォート文字列の追跡
    if (ch === "'" && !inString) {
      inString = true
      current += ch
      continue
    }
    if (ch === "'" && inString) {
      // エスケープされた '' をチェック
      if (i + 1 < where.length && where[i + 1] === "'") {
        current += "''"
        i++
        continue
      }
      inString = false
      current += ch
      continue
    }
    if (inString) {
      current += ch
      continue
    }

    if (ch === '(') depth++
    if (ch === ')') depth--

    // トップレベルの AND を検出
    if (depth === 0) {
      const rest = where.slice(i)
      const andMatch = rest.match(/^\s+AND\s+/i)
      if (andMatch) {
        parts.push(current.trim())
        i += andMatch[0].length - 1
        current = ''
        continue
      }
    }

    current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/**
 * トップレベルの OR で分割する（mixed query の検出用）
 */
export function splitByTopLevelOr(where: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  let inString = false

  for (let i = 0; i < where.length; i++) {
    const ch = where[i]

    if (ch === "'" && !inString) {
      inString = true
      current += ch
      continue
    }
    if (ch === "'" && inString) {
      if (i + 1 < where.length && where[i + 1] === "'") {
        current += "''"
        i++
        continue
      }
      inString = false
      current += ch
      continue
    }
    if (inString) {
      current += ch
      continue
    }

    if (ch === '(') depth++
    if (ch === ')') depth--

    if (depth === 0) {
      const rest = where.slice(i)
      const orMatch = rest.match(/^\s+OR\s+/i)
      if (orMatch) {
        parts.push(current.trim())
        i += orMatch[0].length - 1
        current = ''
        continue
      }
    }

    current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

// ---------------------------------------------------------------------------
// Pattern recognizers
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

/** EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id) */
function tryExistsFilter(cond: string): FilterNode | null {
  // EXISTS media
  if (
    /^EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+post_media\s+WHERE\s+post_id\s*=\s*p\.id\s*\)$/i.test(
      cond,
    )
  ) {
    return {
      kind: 'exists-filter',
      mode: 'exists',
      table: 'post_media',
    } satisfies ExistsFilter
  }
  // NOT EXISTS media
  if (
    /^NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+post_media\s+WHERE\s+post_id\s*=\s*p\.id\s*\)$/i.test(
      cond,
    )
  ) {
    return {
      kind: 'exists-filter',
      mode: 'not-exists',
      table: 'post_media',
    } satisfies ExistsFilter
  }
  return null
}

/** (SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= N */
function tryCountFilter(cond: string): FilterNode | null {
  const match = cond.match(
    /^\(SELECT\s+COUNT\(\*\)\s+FROM\s+post_media\s+WHERE\s+post_id\s*=\s*p\.id\)\s*>=\s*(\d+)$/i,
  )
  if (match) {
    return {
      countValue: Number(match[1]),
      kind: 'exists-filter',
      mode: 'count-gte',
      table: 'post_media',
    } satisfies ExistsFilter
  }
  return null
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

function tryRecognize(condition: string): FilterNode | null {
  const trimmed = condition.trim()
  for (const recognizer of RECOGNIZERS) {
    const result = recognizer(trimmed)
    if (result) return result
  }
  return null
}

// ---------------------------------------------------------------------------
// Query mode detection
// ---------------------------------------------------------------------------

const STATUS_ALIASES = /\b(p|ptt|pme|pb|prb|pr|vt|ps|ht|pe)\.\w/
const NOTIFICATION_ALIASES = /\b(n|nt|ap)\.\w/

/**
 * WHERE 句のクエリモードを判定する。
 * status テーブルのエイリアスと notification テーブルのエイリアスの
 * 両方が参照されている場合は 'mixed'。
 */
export function detectQueryMode(where: string): QueryMode {
  const hasStatus = STATUS_ALIASES.test(where)
  const hasNotification = NOTIFICATION_ALIASES.test(where)

  if (hasStatus && hasNotification) return 'mixed'
  if (hasNotification) return 'notification'
  return 'status'
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * WHERE 句テキストを IR ノードに変換する。
 *
 * 1. v1 旧カラム名を v2 に書き換え
 * 2. トップレベルの AND で分割
 * 3. 各条件をパターンマッチで認識
 * 4. 認識不能な部分は RawSQLFilter にフォールバック
 */
export function parseWhereToNodes(where: string): ParseResult {
  // v1 → v2 書き換え
  const rewritten = rewriteLegacyAliases(where)

  const conditions = splitByTopLevelAnd(rewritten)
  const nodes: FilterNode[] = []
  const unrecognized: string[] = []

  for (const condition of conditions) {
    const trimmed = condition.trim()
    if (!trimmed) continue

    const node = tryRecognize(trimmed)
    if (node) {
      nodes.push(node)
    } else {
      unrecognized.push(trimmed)
    }
  }

  const remainingWhere =
    unrecognized.length > 0 ? unrecognized.join(' AND ') : null

  return { nodes, remainingWhere }
}

/**
 * Mixed query (status OR notification) を分割してパースする。
 *
 * 「ptt.timelineType = 'home' OR nt.name IN ('favourite', 'reblog')」
 * のようなクエリをトップレベル OR で分割し、
 * status 側と notification 側それぞれのノードを返す。
 */
export function parseMixedQuery(where: string): {
  statusNodes: ParseResult
  notificationNodes: ParseResult
} {
  const rewritten = rewriteLegacyAliases(where)
  const orParts = splitByTopLevelOr(rewritten)

  const statusParts: string[] = []
  const notificationParts: string[] = []

  for (const part of orParts) {
    const mode = detectQueryMode(part)
    if (mode === 'notification') {
      notificationParts.push(part)
    } else {
      statusParts.push(part)
    }
  }

  return {
    notificationNodes: parseWhereToNodes(notificationParts.join(' AND ')),
    statusNodes: parseWhereToNodes(statusParts.join(' AND ')),
  }
}

/**
 * WHERE 句テキストから完全な QueryPlan を構築するヘルパー。
 * Mixed query の場合は MergeNode を含む QueryPlan を返す。
 */
export function whereToQueryPlan(
  where: string,
  context: { queryLimit: number; localAccountIds?: number[] },
): QueryPlan {
  const mode = detectQueryMode(where)

  if (mode === 'mixed') {
    const { statusNodes, notificationNodes } = parseMixedQuery(where)
    const statusFilters = buildFiltersWithRemainder(statusNodes)
    const notifFilters = buildFiltersWithRemainder(notificationNodes)

    return {
      composites: [
        {
          kind: 'merge',
          limit: context.queryLimit,
          sources: [
            {
              composites: [],
              filters: statusFilters,
              pagination: {
                kind: 'pagination',
                limit: context.queryLimit,
              },
              sort: {
                direction: 'DESC',
                field: 'created_at_ms',
                kind: 'sort',
              },
              source: { kind: 'source', table: 'posts' },
            },
            {
              composites: [],
              filters: notifFilters,
              pagination: {
                kind: 'pagination',
                limit: context.queryLimit,
              },
              sort: {
                direction: 'DESC',
                field: 'created_at_ms',
                kind: 'sort',
              },
              source: { kind: 'source', table: 'notifications' },
            },
          ],
          strategy: 'interleave-by-time',
        },
      ],
      filters: [],
      pagination: { kind: 'pagination', limit: context.queryLimit },
      sort: { direction: 'DESC', field: 'created_at_ms', kind: 'sort' },
      source: { kind: 'source', table: 'posts' },
    }
  }

  const table = mode === 'notification' ? 'notifications' : 'posts'
  const parseResult = parseWhereToNodes(where)
  const filters = buildFiltersWithRemainder(parseResult)

  return {
    composites: [],
    filters,
    pagination: { kind: 'pagination', limit: context.queryLimit },
    sort: { direction: 'DESC', field: 'created_at_ms', kind: 'sort' },
    source: { kind: 'source', table },
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildFiltersWithRemainder(result: ParseResult): FilterNode[] {
  const filters = [...result.nodes]
  if (result.remainingWhere) {
    filters.push({
      kind: 'raw-sql-filter',
      where: result.remainingWhere,
    } satisfies RawSQLFilter)
  }
  return filters
}
