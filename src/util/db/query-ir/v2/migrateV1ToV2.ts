// ============================================================
// QueryPlan V1 → QueryPlanV2 移行
// ============================================================

import type {
  FilterNode,
  GetIdsFilter,
  GetIdsNode,
  MergeNodeV2,
  OutputNodeV2,
  QueryNodeV2,
  QueryPlan,
  QueryPlanV2,
  QueryPlanV2Edge,
  QueryPlanV2Node,
} from '../nodes'
import {
  filterNodeToGetIdsFilter,
  partitionOrGroups,
  timelineScopeToFilters,
} from './filterMapping'

let idSeq = 0

function nid(): string {
  idSeq += 1
  return `v2n-${idSeq}`
}

function resetIds(): void {
  idSeq = 0
}

function appendFilterConversion(
  f: FilterNode,
  filters: GetIdsFilter[],
  overlay: FilterNode[],
): void {
  if (f.kind === 'timeline-scope') {
    filters.push(...timelineScopeToFilters(f))
    return
  }
  const g = filterNodeToGetIdsFilter(f)
  if (g != null) {
    filters.push(g)
  } else {
    overlay.push(f)
  }
}

/** ブランチ内の FilterNode を GetIdsFilter[] に変換 */
function branchToGetIdsFilters(nodes: FilterNode[]): GetIdsFilter[] {
  const out: GetIdsFilter[] = []
  for (const n of nodes) {
    if (n.kind === 'timeline-scope') {
      out.push(...timelineScopeToFilters(n))
    } else {
      const g = filterNodeToGetIdsFilter(n)
      if (g != null) out.push(g)
    }
  }
  return out
}

function buildGetIdsFromPlan(plan: QueryPlan): {
  getIds: GetIdsNode
  overlay: FilterNode[]
} {
  const { base, orBranches } = partitionOrGroups(plan.filters)
  const overlay: FilterNode[] = []
  const filters: GetIdsFilter[] = []

  for (const f of base) {
    appendFilterConversion(f, filters, overlay)
  }

  const v2OrBranches: GetIdsFilter[][] = []
  for (const branch of orBranches) {
    const converted = branchToGetIdsFilters(branch)
    if (converted.length > 0) {
      v2OrBranches.push(converted)
    }
  }

  const getIds: GetIdsNode = {
    filters,
    kind: 'get-ids',
    orBranches: v2OrBranches.length > 0 ? v2OrBranches : undefined,
    table: plan.source.table,
  }

  return { getIds, overlay }
}

/**
 * Merge 以外の単一ソース QueryPlan を V2 グラフに変換する。
 */
function mergeFreePlanToV2(plan: QueryPlan): QueryPlanV2 {
  resetIds()
  const { getIds, overlay } = buildGetIdsFromPlan(plan)

  const gId = nid()
  const oId = nid()

  const outputNode: OutputNodeV2 = {
    displayMode: 'auto',
    kind: 'output-v2',
    pagination: {
      limit: plan.pagination.limit,
      offset: plan.pagination.offset,
    },
    sort: {
      direction: plan.sort.direction,
      field: plan.sort.field,
    },
  }

  const nodes: QueryPlanV2Node[] = [
    { id: gId, node: getIds satisfies QueryNodeV2 },
    { id: oId, node: outputNode satisfies QueryNodeV2 },
  ]
  const edges: QueryPlanV2Edge[] = [{ source: gId, target: oId }]

  return {
    edges,
    legacyV1Overlay: overlay.length > 0 ? { filters: overlay } : undefined,
    nodes,
    version: 2,
  }
}

/**
 * Merge 複合を含む QueryPlan を V2 に変換する。
 */
function mergePlanToV2(plan: QueryPlan): QueryPlanV2 {
  resetIds()
  const mergeComposite = plan.composites.find((c) => c.kind === 'merge')
  if (!mergeComposite || mergeComposite.kind !== 'merge') {
    return mergeFreePlanToV2(plan)
  }

  /** マージプランのトップレベル filters（各ブランチに AND される）をそのまま保持 */
  const topOverlay: FilterNode[] = [...plan.filters]

  const mergeId = nid()
  const outId = nid()

  const mergeNode: MergeNodeV2 = {
    kind: 'merge-v2',
    limit: mergeComposite.limit,
    strategy:
      mergeComposite.strategy === 'interleave-by-time'
        ? 'interleave-by-time'
        : 'union',
  }

  const outputNode: OutputNodeV2 = {
    displayMode: 'auto',
    kind: 'output-v2',
    pagination: {
      limit: plan.pagination.limit,
      offset: plan.pagination.offset,
    },
    sort: {
      direction: plan.sort.direction,
      field: plan.sort.field,
    },
  }

  const nodes: QueryPlanV2Node[] = [
    { id: mergeId, node: mergeNode satisfies QueryNodeV2 },
    { id: outId, node: outputNode satisfies QueryNodeV2 },
  ]
  const edges: QueryPlanV2Edge[] = [{ source: mergeId, target: outId }]

  for (const sub of mergeComposite.sources) {
    const { getIds, overlay } = buildGetIdsFromPlan(sub)
    if (overlay.length > 0) {
      topOverlay.push(...overlay)
    }
    const gid = nid()
    nodes.push({ id: gid, node: getIds satisfies QueryNodeV2 })
    edges.push({ source: gid, target: mergeId })
  }

  return {
    edges,
    legacyV1Overlay:
      topOverlay.length > 0 ? { filters: topOverlay } : undefined,
    nodes,
    version: 2,
  }
}

/**
 * V1 QueryPlan を V2 グラフに変換する。
 */
export function migrateQueryPlanV1ToV2(plan: QueryPlan): QueryPlanV2 {
  const hasMerge = plan.composites.some((c) => c.kind === 'merge')
  if (hasMerge) {
    return mergePlanToV2(plan)
  }
  return mergeFreePlanToV2(plan)
}
