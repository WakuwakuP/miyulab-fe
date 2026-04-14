import type { BackendFilter, TimelineConfigV2 } from 'types/types'
import { resolveBackendUrlFromAccountId } from 'util/accountResolver'
import type { ConfigToNodesContext } from 'util/db/query-ir/compat/configToNodes'
import { configToQueryPlan } from 'util/db/query-ir/compat/configToNodes'
import type { QueryPlanV2 } from 'util/db/query-ir/nodes'
import { isQueryPlanV2 } from 'util/db/query-ir/nodes'
import { migrateQueryPlanV1ToV2 } from 'util/db/query-ir/v2/migrateV1ToV2'

// --------------- Default QueryPlanV2 ---------------

export function createDefaultQueryPlanV2(): QueryPlanV2 {
  const a =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `a-${Date.now()}`
  const b =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `b-${Date.now() + 1}`
  return {
    edges: [{ source: a, target: b }],
    nodes: [
      {
        id: a,
        node: { filters: [], kind: 'get-ids', table: 'posts' },
      },
      {
        id: b,
        node: {
          displayMode: 'auto',
          kind: 'output-v2',
          pagination: { limit: 50 },
          sort: { direction: 'DESC', field: 'created_at_ms' },
        },
      },
    ],
    version: 2,
  }
}

export function planFromConfig(config: TimelineConfigV2): QueryPlanV2 {
  if (config.queryPlan) {
    if (isQueryPlanV2(config.queryPlan)) {
      return config.queryPlan
    }
    return migrateQueryPlanV1ToV2(config.queryPlan)
  }
  const ctx: ConfigToNodesContext = {
    localAccountIds: [],
    queryLimit: 50,
    serverIds: [],
  }
  return migrateQueryPlanV1ToV2(configToQueryPlan(config, ctx))
}

// --------------- V2 plan analysis helpers ---------------

/** V2 plan の GetIds ノードから backendFilter を抽出する */
export function extractBackendFilter(plan: QueryPlanV2): BackendFilter {
  for (const n of plan.nodes) {
    if (n.node.kind !== 'get-ids') continue
    const f = n.node.filters.find(
      (f) => 'column' in f && f.column === 'local_account_id' && f.op === 'IN',
    )
    if (!f || !('value' in f) || !f.value) continue
    const urls = (f.value as number[])
      .map((id) => resolveBackendUrlFromAccountId(id))
      .filter((u): u is string => u != null)
    if (urls.length === 0) return { mode: 'all' }
    if (urls.length === 1) return { backendUrl: urls[0], mode: 'single' }
    return { backendUrls: urls, mode: 'composite' }
  }
  return { mode: 'all' }
}

/** V2 plan から moderation (mute/block) 設定を検出する */
export function extractModeration(plan: QueryPlanV2): {
  applyBlock: boolean
  applyMute: boolean
} {
  let hasMute = false
  let hasBlock = false
  for (const n of plan.nodes) {
    if (n.node.kind !== 'get-ids') continue
    for (const f of n.node.filters) {
      if ('mode' in f && f.mode === 'not-exists') {
        if (f.table === 'muted_accounts') hasMute = true
        if (f.table === 'blocked_instances') hasBlock = true
      }
    }
  }
  return { applyBlock: hasBlock, applyMute: hasMute }
}

/** V2 plan のノード構成をテキスト要約する */
export function summarizeV2Plan(plan: QueryPlanV2): string {
  const lines: string[] = []
  for (const n of plan.nodes) {
    const { kind } = n.node
    switch (kind) {
      case 'get-ids': {
        const node = n.node
        const filterCount = node.filters.length
        lines.push(
          `[${n.id.slice(0, 8)}] GetIds(${node.table}) — ${filterCount} filters`,
        )
        break
      }
      case 'lookup-related': {
        const node = n.node
        lines.push(`[${n.id.slice(0, 8)}] LookupRelated(${node.lookupTable})`)
        break
      }
      case 'merge-v2': {
        const node = n.node
        lines.push(
          `[${n.id.slice(0, 8)}] Merge(${node.strategy}, limit=${node.limit})`,
        )
        break
      }
      case 'output-v2': {
        const node = n.node
        lines.push(
          `[${n.id.slice(0, 8)}] Output(${node.sort.direction}, limit=${node.pagination.limit})`,
        )
        break
      }
    }
  }
  const edgeLines = plan.edges.map(
    (e) => `  ${e.source.slice(0, 8)} → ${e.target.slice(0, 8)}`,
  )
  return `Nodes:\n${lines.join('\n')}\n\nEdges:\n${edgeLines.join('\n')}`
}
