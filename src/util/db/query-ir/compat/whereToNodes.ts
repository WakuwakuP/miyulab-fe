// ============================================================
// whereToNodes — WHERE 句テキスト → IR ノード変換パーサ
// ============================================================
//
// ユーザーが入力した Advanced Query の WHERE 句テキストを
// 認識可能なパターンは IR ノードに、認識不能な部分は
// RawSQLFilter にフォールバックする。
//
// 実装は以下のモジュールに分割されている:
//   - splitters.ts    — トップレベル AND / OR 分割
//   - recognizers.ts  — 条件パターン → FilterNode 変換
//   - queryMode.ts    — クエリモード判定

import type { FilterNode, QueryPlan, RawSQLFilter } from '../nodes'
import { rewriteLegacyAliases } from './legacyAliases'
import { detectQueryMode } from './queryMode'
import { tryRecognize } from './recognizers'
import { splitByTopLevelAnd, splitByTopLevelOr } from './splitters'

// ---------------------------------------------------------------------------
// Re-exports (既存の import パスを維持)
// ---------------------------------------------------------------------------

export type { QueryMode } from './queryMode'
export { detectQueryMode } from './queryMode'
export { splitByTopLevelAnd, splitByTopLevelOr } from './splitters'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ParseResult = {
  /** 認識できたノード */
  nodes: FilterNode[]
  /** 認識できなかった残余 WHERE (null = 全て認識済み) */
  remainingWhere: string | null
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
