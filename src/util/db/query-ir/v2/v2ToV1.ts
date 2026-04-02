// ============================================================
// QueryPlanV2 → QueryPlan (V1) — 実行パイプライン向け
// ============================================================

import type {
  AerialReplyFilter,
  ExistsCondition,
  FilterCondition,
  FilterNode,
  GetIdsFilter,
  GetIdsNode,
  LookupRelatedNode,
  MergeNodeV2,
  OutputNodeV2,
  QueryPlan,
  QueryPlanV2,
  QueryPlanV2Node,
  TableFilter,
} from '../nodes'

function getNodeMap(plan: QueryPlanV2): Map<string, QueryPlanV2Node> {
  return new Map(plan.nodes.map((n) => [n.id, n]))
}

function incoming(plan: QueryPlanV2, targetId: string): string[] {
  return plan.edges.filter((e) => e.target === targetId).map((e) => e.source)
}

function filterConditionToFilterNode(c: FilterCondition): TableFilter {
  return {
    column: c.column,
    kind: 'table-filter',
    op: c.op,
    table: c.table,
    value: c.value,
  }
}

function existsConditionToFilterNode(e: ExistsCondition): FilterNode {
  return {
    countValue: e.countValue,
    innerFilters: e.innerFilters?.map(filterConditionToFilterNode),
    kind: 'exists-filter',
    mode: e.mode,
    table: e.table,
  }
}

function getIdsFilterToFilterNode(f: GetIdsFilter): FilterNode {
  if ('column' in f && 'op' in f) {
    return filterConditionToFilterNode(f as FilterCondition)
  }
  return existsConditionToFilterNode(f as ExistsCondition)
}

function getIdsToFilterNodes(node: GetIdsNode): FilterNode[] {
  const filters: FilterNode[] = node.filters.map(getIdsFilterToFilterNode)
  if (node.orBranches && node.orBranches.length > 0) {
    const branches: FilterNode[][] = node.orBranches.map((branch) =>
      branch.map(getIdsFilterToFilterNode),
    )
    filters.push({ branches, kind: 'or-group' })
  }
  return filters
}

/** lookupRelated + 入力 notifications を空中リプライ近似に変換（既定ジョイン時） */
function lookupToAerialFallback(
  lookup: LookupRelatedNode,
  inputTable: string,
  getIdsNode?: GetIdsNode,
): AerialReplyFilter | null {
  if (inputTable !== 'notifications' || lookup.lookupTable !== 'posts') {
    return null
  }
  // getIds の notification_types.name フィルタから通知種別を抽出
  let notificationTypes: string[] = ['favourite', 'reaction', 'reblog']
  if (getIdsNode) {
    const typeFilters = getIdsNode.filters.filter(
      (f): f is import('../nodes').FilterCondition =>
        'op' in f &&
        f.table === 'notification_types' &&
        f.column === 'name' &&
        (f.op === '=' || f.op === 'IN'),
    )
    if (typeFilters.length > 0) {
      const extracted = typeFilters.flatMap((f) =>
        Array.isArray(f.value)
          ? (f.value as string[])
          : f.value != null
            ? [String(f.value)]
            : [],
      )
      if (extracted.length > 0) notificationTypes = extracted
    }
  }
  return {
    kind: 'aerial-reply-filter',
    notificationTypes,
    timeWindowMs: lookup.timeCondition?.windowMs ?? 180000,
  }
}

/**
 * getIds 単体（子なし）から QueryPlan を構築
 */
/**
 * timeline_entries ソースを posts に正規化する。
 *
 * compilePhase1ForTimeline は固定テンプレート
 *   FROM timeline_entries te INNER JOIN posts p ON p.id = te.post_id
 * を使い、sourceAlias = 'p' (= posts) でフィルタを解決する。
 * sourceTable が 'timeline_entries' だと同テーブルフィルタが
 * 'direct' 戦略 → p.local_account_id (posts には存在しない) を生成してしまう。
 * 'posts' に正規化すれば timeline_entries フィルタは 'exists' 戦略になり正しい SQL になる。
 */
function normalizeSourceTable(table: string): string {
  return table === 'timeline_entries' ? 'posts' : table
}

function getIdsNodeOnlyToPlan(
  g: GetIdsNode,
  out: OutputNodeV2,
  overlay: FilterNode[] | undefined,
): QueryPlan {
  const filters = [...getIdsToFilterNodes(g), ...(overlay ?? [])]
  const table = normalizeSourceTable(g.table)
  return {
    composites: [],
    filters,
    pagination: {
      kind: 'pagination',
      limit: out.pagination.limit,
      offset: out.pagination.offset,
    },
    sort: {
      direction: out.sort.direction,
      field: out.sort.field,
      kind: 'sort',
    },
    source: {
      idColumn: table === g.table ? g.outputIdColumn : undefined,
      kind: 'source',
      table,
      timeColumn: table === g.table ? g.outputTimeColumn : undefined,
    },
  }
}

/**
 * output から逆方向にたどり、getIds → output または lookup 連鎖を V1 に畳み込む。
 */
function tryLinearizeFromOutput(
  plan: QueryPlanV2,
  outId: string,
  outNode: OutputNodeV2,
  overlay: FilterNode[] | undefined,
): QueryPlan | null {
  const inc0 = incoming(plan, outId)
  if (inc0.length !== 1) return null
  const byId = getNodeMap(plan)

  let cur = inc0[0]
  const lookups: LookupRelatedNode[] = []

  while (true) {
    const wrap = byId.get(cur)
    if (!wrap) return null
    const n = wrap.node

    if (n.kind === 'lookup-related') {
      lookups.push(n)
      const incL = incoming(plan, cur)
      if (incL.length !== 1) return null
      cur = incL[0]
      continue
    }

    if (n.kind === 'get-ids') {
      if (lookups.length === 0) {
        return getIdsNodeOnlyToPlan(n, outNode, overlay)
      }
      const last = lookups[lookups.length - 1]
      const aerial = lookupToAerialFallback(last, n.table, n)
      if (!aerial) return null
      return {
        composites: [],
        filters: [aerial, ...(overlay ?? [])],
        pagination: {
          kind: 'pagination',
          limit: outNode.pagination.limit,
          offset: outNode.pagination.offset,
        },
        sort: {
          direction: outNode.sort.direction,
          field: outNode.sort.field,
          kind: 'sort',
        },
        source: { kind: 'source', table: last.lookupTable },
      }
    }

    return null
  }
}

function mergeV2ToPlan(
  plan: QueryPlanV2,
  mergeId: string,
  merge: MergeNodeV2,
  out: OutputNodeV2,
  overlay: FilterNode[] | undefined,
): QueryPlan | null {
  const srcIds = incoming(plan, mergeId)
  if (srcIds.length < 1) return null
  const byId = getNodeMap(plan)

  const sources: QueryPlan[] = []
  for (const sid of srcIds) {
    const n = byId.get(sid)?.node
    if (!n || n.kind !== 'get-ids') return null
    const g = n
    const table = normalizeSourceTable(g.table)
    sources.push({
      composites: [],
      filters: getIdsToFilterNodes(g),
      pagination: {
        kind: 'pagination',
        limit: out.pagination.limit,
        offset: out.pagination.offset,
      },
      sort: {
        direction: out.sort.direction,
        field: out.sort.field,
        kind: 'sort',
      },
      source: {
        idColumn: table === g.table ? g.outputIdColumn : undefined,
        kind: 'source',
        table,
        timeColumn: table === g.table ? g.outputTimeColumn : undefined,
      },
    })
  }

  return {
    composites: [
      {
        kind: 'merge',
        limit: merge.limit,
        sources,
        strategy: 'interleave-by-time',
      },
    ],
    filters: [...(overlay ?? [])],
    pagination: {
      kind: 'pagination',
      limit: out.pagination.limit,
      offset: out.pagination.offset,
    },
    sort: {
      direction: out.sort.direction,
      field: out.sort.field,
      kind: 'sort',
    },
    source: sources[0]?.source ?? { kind: 'source', table: 'posts' },
  }
}

/**
 * QueryPlanV2 を実行用 QueryPlan (V1 形状) に変換する。
 */
export function queryPlanV2ToQueryPlanV1(plan: QueryPlanV2): QueryPlan {
  const overlay = plan.legacyV1Overlay?.filters
  const byId = getNodeMap(plan)

  const outEntry = plan.nodes.find((n) => n.node.kind === 'output-v2')
  if (!outEntry) {
    return {
      composites: [],
      filters: [...(overlay ?? [])],
      pagination: { kind: 'pagination', limit: 50 },
      sort: {
        direction: 'DESC',
        field: 'created_at_ms',
        kind: 'sort',
      },
      source: { kind: 'source', table: 'posts' },
    }
  }

  const outNode = outEntry.node as OutputNodeV2
  const inc = incoming(plan, outEntry.id)

  if (inc.length === 1) {
    const prev = byId.get(inc[0])?.node
    if (prev?.kind === 'merge-v2') {
      const m = mergeV2ToPlan(plan, inc[0], prev, outNode, overlay)
      if (m) return m
    }
    const linear = tryLinearizeFromOutput(plan, outEntry.id, outNode, overlay)
    if (linear) return linear

    if (prev?.kind === 'get-ids') {
      return getIdsNodeOnlyToPlan(prev, outNode, overlay)
    }
  }

  /** フォールバック: 最初の getIds + output だけ拾う */
  const firstGet = plan.nodes.find((n) => n.node.kind === 'get-ids')?.node as
    | GetIdsNode
    | undefined
  if (firstGet) {
    return getIdsNodeOnlyToPlan(firstGet, outNode, overlay)
  }

  return {
    composites: [],
    filters: [...(overlay ?? [])],
    pagination: {
      kind: 'pagination',
      limit: outNode.pagination.limit,
      offset: outNode.pagination.offset,
    },
    sort: {
      direction: outNode.sort.direction,
      field: outNode.sort.field,
      kind: 'sort',
    },
    source: { kind: 'source', table: 'posts' },
  }
}
