// ============================================================
// Graph Executor — メインオーケストレータ
//
// QueryPlanV2 のグラフを Worker 内で実行する。
// 1. トポロジカルソートで実行順序を決定
// 2. 各ノードをキャッシュ付きで実行
// 3. Output ノードで Phase2/Phase3 を実行して最終結果を返す
// ============================================================

import type { DbExec } from '../../sqlite/queries/executionEngine'
import type {
  GetIdsNode,
  LookupRelatedNode,
  MergeNodeV2,
  OutputNodeV2,
} from '../nodes'
import { executeGetIds } from './getIdsExecutor'
import { executeLookupRelated } from './lookupRelatedExecutor'
import { executeMerge } from './mergeExecutor'
import { executeOutput } from './outputExecutor'
import { topoSort } from './topoSort'
import type {
  DisplayOrderEntry,
  GraphExecuteOptions,
  GraphExecuteResult,
  NodeOutput,
  NodeStat,
  SerializedGraphPlan,
} from './types'
import { WorkerNodeCache } from './workerNodeCache'

// --------------- シングルトンキャッシュ ---------------

let globalCache: WorkerNodeCache | null = null

function getCache(): WorkerNodeCache {
  if (!globalCache) {
    globalCache = new WorkerNodeCache()
  }
  return globalCache
}

/** 外部からキャッシュをクリアする（デバッグ・テスト用） */
export function clearGraphCache(): void {
  globalCache?.clear()
}

/** 外部からテーブルバージョンを bump する（write 通知用） */
export function bumpGraphCacheVersion(table: string): void {
  getCache().bumpVersion(table)
}

/** テーブルバージョンマップを同期する */
export function syncGraphCacheVersions(versions: Map<string, number>): void {
  getCache().syncVersions(versions)
}

// --------------- ヘルパー ---------------

/** outputs Map から各ノードの中間出力 ID をスナップショットする */
function snapshotNodeOutputIds(
  outputs: Map<string, NodeOutput>,
): Record<string, DisplayOrderEntry[]> {
  const result: Record<string, DisplayOrderEntry[]> = {}
  for (const [nodeId, output] of outputs) {
    result[nodeId] = output.rows.map((r) => ({
      id: r.id,
      table: r.table as 'posts' | 'notifications',
    }))
  }
  return result
}

function buildIncomingEdgesMap(
  edges: SerializedGraphPlan['edges'],
): Map<string, string[]> {
  const incomingEdges = new Map<string, string[]>()
  for (const edge of edges) {
    const existing = incomingEdges.get(edge.target) ?? []
    existing.push(edge.source)
    incomingEdges.set(edge.target, existing)
  }
  return incomingEdges
}

function getFirstUpstreamOutput(
  incoming: string[],
  outputs: Map<string, NodeOutput>,
): NodeOutput | undefined {
  return incoming.length > 0 ? outputs.get(incoming[0]) : undefined
}

function collectUpstreamOutputs(
  incoming: string[],
  outputs: Map<string, NodeOutput>,
): Map<string, NodeOutput> {
  const upstreamOutputs = new Map<string, NodeOutput>()
  for (const srcId of incoming) {
    const out = outputs.get(srcId)
    if (out) upstreamOutputs.set(srcId, out)
  }
  return upstreamOutputs
}

function collectUpstreamOutputList(
  incoming: string[],
  outputs: Map<string, NodeOutput>,
): NodeOutput[] {
  const inputs: NodeOutput[] = []
  for (const srcId of incoming) {
    const out = outputs.get(srcId)
    if (out) inputs.push(out)
  }
  return inputs
}

function recordNodeStat(
  nodeStats: Record<string, NodeStat>,
  nodeId: string,
  nodeStart: number,
  cacheHit: boolean,
  rowCount: number,
): void {
  nodeStats[nodeId] = {
    cacheHit,
    durationMs: performance.now() - nodeStart,
    rowCount,
  }
}

function buildEmptyGraphResult(
  nodeStats: Record<string, NodeStat>,
  outputs: Map<string, NodeOutput>,
  start: number,
  captureVersionsFn: () => Record<string, number>,
): GraphExecuteResult {
  return {
    capturedVersions: captureVersionsFn(),
    displayOrder: [],
    meta: {
      nodeStats,
      sourceType: 'post',
      totalDurationMs: performance.now() - start,
    },
    nodeOutputIds: snapshotNodeOutputIds(outputs),
    notifications: { detailRows: [] },
    posts: { batchResults: {}, detailRows: [] },
  }
}

function runGetIdsNode(
  db: DbExec,
  cache: WorkerNodeCache,
  outputs: Map<string, NodeOutput>,
  nodeStats: Record<string, NodeStat>,
  nodeId: string,
  node: GetIdsNode,
  incoming: string[],
  globalLimit: number | undefined,
  nodeStart: number,
): void {
  const upstreamOutputs = collectUpstreamOutputs(incoming, outputs)
  const upstreamHash =
    upstreamOutputs.size > 0
      ? [...upstreamOutputs.values()].map((o) => o.hash).join('+')
      : undefined

  const { sql, binds, dependentTables, output } = executeGetIds(
    db,
    node,
    upstreamOutputs,
    globalLimit,
  )

  const cacheKey = { binds, nodeId, sql, upstreamHash }
  const cached = cache.get(cacheKey)
  if (cached) {
    outputs.set(nodeId, {
      hash: output.hash,
      rows: cached,
      sourceTable: output.sourceTable,
    })
    recordNodeStat(nodeStats, nodeId, nodeStart, true, cached.length)
    return
  }

  cache.set(cacheKey, output.rows, dependentTables)
  outputs.set(nodeId, output)
  recordNodeStat(nodeStats, nodeId, nodeStart, false, output.rows.length)
}

function runLookupRelatedNode(
  db: DbExec,
  cache: WorkerNodeCache,
  outputs: Map<string, NodeOutput>,
  nodeStats: Record<string, NodeStat>,
  nodeId: string,
  node: LookupRelatedNode,
  incoming: string[],
  nodeStart: number,
): void {
  const firstInput = getFirstUpstreamOutput(incoming, outputs)
  if (!firstInput) {
    outputs.set(nodeId, {
      hash: 'lookup:no-input',
      rows: [],
      sourceTable: node.lookupTable,
    })
    recordNodeStat(nodeStats, nodeId, nodeStart, false, 0)
    return
  }

  const { sql, binds, dependentTables, output } = executeLookupRelated(
    db,
    node,
    firstInput,
  )

  const cacheKey = {
    binds,
    nodeId,
    sql,
    upstreamHash: firstInput.hash,
  }
  const cached = cache.get(cacheKey)
  if (cached) {
    outputs.set(nodeId, {
      hash: output.hash,
      rows: cached,
      sourceTable: node.lookupTable,
    })
    recordNodeStat(nodeStats, nodeId, nodeStart, true, cached.length)
    return
  }

  cache.set(cacheKey, output.rows, dependentTables)
  outputs.set(nodeId, output)
  recordNodeStat(nodeStats, nodeId, nodeStart, false, output.rows.length)
}

function runMergeNode(
  outputs: Map<string, NodeOutput>,
  nodeStats: Record<string, NodeStat>,
  nodeId: string,
  node: MergeNodeV2,
  incoming: string[],
  nodeStart: number,
): void {
  const inputs = collectUpstreamOutputList(incoming, outputs)
  const output = executeMerge(node, inputs)
  outputs.set(nodeId, output)
  recordNodeStat(nodeStats, nodeId, nodeStart, false, output.rows.length)
}

function runOutputNode(
  db: DbExec,
  outputs: Map<string, NodeOutput>,
  nodeStats: Record<string, NodeStat>,
  nodeId: string,
  node: OutputNodeV2,
  incoming: string[],
  options: GraphExecuteOptions,
  nodeStart: number,
  start: number,
  captureVersionsFn: () => Record<string, number>,
): GraphExecuteResult {
  const firstInput = getFirstUpstreamOutput(incoming, outputs)
  if (!firstInput) {
    return buildEmptyGraphResult(nodeStats, outputs, start, captureVersionsFn)
  }

  const result = executeOutput(db, node, firstInput, options.backendUrls)
  recordNodeStat(
    nodeStats,
    nodeId,
    nodeStart,
    false,
    result.displayOrder.length,
  )

  return {
    capturedVersions: captureVersionsFn(),
    displayOrder: result.displayOrder,
    meta: {
      nodeStats,
      sourceType: result.sourceType,
      totalDurationMs: performance.now() - start,
    },
    nodeOutputIds: snapshotNodeOutputIds(outputs),
    notifications: result.notifications,
    posts: result.posts,
  }
}

// --------------- メイン実行関数 ---------------

/**
 * QueryPlanV2 をグラフ実行する。
 *
 * Worker 内で呼び出される。各ノードを依存順に実行し、
 * キャッシュヒット時は DB 実行をスキップする。
 *
 * @param db - SQLite 実行ハンドル
 * @param plan - シリアライズされたグラフプラン
 * @param options - 実行オプション（backendUrls 等）
 * @param captureVersionsFn - テーブルバージョンスナップショット取得関数
 */
export function executeGraphPlan(
  db: DbExec,
  plan: SerializedGraphPlan,
  options: GraphExecuteOptions,
  captureVersionsFn: () => Record<string, number>,
): GraphExecuteResult {
  const start = performance.now()
  const cache = getCache()

  const nodeMap = new Map(plan.nodes.map((n) => [n.id, n]))
  const executionOrder = topoSort(plan)
  const outputs = new Map<string, NodeOutput>()
  const nodeStats: Record<string, NodeStat> = {}
  const incomingEdges = buildIncomingEdgesMap(plan.edges)

  const outputNode = plan.nodes.find((n) => n.node.kind === 'output-v2')
  const globalLimit = outputNode
    ? (outputNode.node as OutputNodeV2).pagination.limit
    : undefined

  for (const nodeId of executionOrder) {
    const entry = nodeMap.get(nodeId)
    if (!entry) continue

    const nodeStart = performance.now()
    const incoming = incomingEdges.get(nodeId) ?? []

    switch (entry.node.kind) {
      case 'get-ids':
        runGetIdsNode(
          db,
          cache,
          outputs,
          nodeStats,
          nodeId,
          entry.node as GetIdsNode,
          incoming,
          globalLimit,
          nodeStart,
        )
        break
      case 'lookup-related':
        runLookupRelatedNode(
          db,
          cache,
          outputs,
          nodeStats,
          nodeId,
          entry.node as LookupRelatedNode,
          incoming,
          nodeStart,
        )
        break
      case 'merge-v2':
        runMergeNode(
          outputs,
          nodeStats,
          nodeId,
          entry.node as MergeNodeV2,
          incoming,
          nodeStart,
        )
        break
      case 'output-v2':
        return runOutputNode(
          db,
          outputs,
          nodeStats,
          nodeId,
          entry.node as OutputNodeV2,
          incoming,
          options,
          nodeStart,
          start,
          captureVersionsFn,
        )
    }
  }

  return buildEmptyGraphResult(nodeStats, outputs, start, captureVersionsFn)
}
