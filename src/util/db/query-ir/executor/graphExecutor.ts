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

  // ノードマップ構築
  const nodeMap = new Map(plan.nodes.map((n) => [n.id, n]))

  // トポロジカルソート
  const executionOrder = topoSort(plan)

  // 各ノードの出力を保持
  const outputs = new Map<string, NodeOutput>()
  const nodeStats: Record<string, NodeStat> = {}

  // エッジから入力ノード ID を引くためのマップ
  const incomingEdges = new Map<string, string[]>()
  for (const edge of plan.edges) {
    const existing = incomingEdges.get(edge.target) ?? []
    existing.push(edge.source)
    incomingEdges.set(edge.target, existing)
  }

  // Output ノードの pagination.limit を取得（GetIds の上限として使用）
  const outputNode = plan.nodes.find((n) => n.node.kind === 'output-v2')
  const globalLimit = outputNode
    ? (outputNode.node as OutputNodeV2).pagination.limit
    : undefined

  // --- 各ノードを順番に実行 ---
  for (const nodeId of executionOrder) {
    const entry = nodeMap.get(nodeId)
    if (!entry) continue

    const nodeStart = performance.now()
    const incoming = incomingEdges.get(nodeId) ?? []

    switch (entry.node.kind) {
      case 'get-ids': {
        const node = entry.node as GetIdsNode

        // 上流の出力を収集
        const upstreamOutputs = new Map<string, NodeOutput>()
        for (const srcId of incoming) {
          const out = outputs.get(srcId)
          if (out) upstreamOutputs.set(srcId, out)
        }

        // キャッシュチェック用の上流ハッシュ
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

        // キャッシュチェック
        const cacheKey = {
          binds,
          nodeId,
          sql,
          upstreamHash,
        }
        const cached = cache.get(cacheKey)
        if (cached) {
          const cachedOutput: NodeOutput = {
            hash: output.hash,
            rows: cached,
            sourceTable: node.table,
          }
          outputs.set(nodeId, cachedOutput)
          nodeStats[nodeId] = {
            cacheHit: true,
            durationMs: performance.now() - nodeStart,
            rowCount: cached.length,
          }
          break
        }

        // キャッシュに保存
        cache.set(cacheKey, output.rows, dependentTables)
        outputs.set(nodeId, output)
        nodeStats[nodeId] = {
          cacheHit: false,
          durationMs: performance.now() - nodeStart,
          rowCount: output.rows.length,
        }
        break
      }

      case 'lookup-related': {
        const node = entry.node as LookupRelatedNode

        // 最初の上流出力を入力として使用
        const firstInput =
          incoming.length > 0 ? outputs.get(incoming[0]) : undefined
        if (!firstInput) {
          outputs.set(nodeId, {
            hash: 'lookup:no-input',
            rows: [],
            sourceTable: node.lookupTable,
          })
          nodeStats[nodeId] = {
            cacheHit: false,
            durationMs: performance.now() - nodeStart,
            rowCount: 0,
          }
          break
        }

        const { sql, binds, dependentTables, output } = executeLookupRelated(
          db,
          node,
          firstInput,
        )

        // キャッシュチェック
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
          nodeStats[nodeId] = {
            cacheHit: true,
            durationMs: performance.now() - nodeStart,
            rowCount: cached.length,
          }
          break
        }

        cache.set(cacheKey, output.rows, dependentTables)
        outputs.set(nodeId, output)
        nodeStats[nodeId] = {
          cacheHit: false,
          durationMs: performance.now() - nodeStart,
          rowCount: output.rows.length,
        }
        break
      }

      case 'merge-v2': {
        const node = entry.node as MergeNodeV2

        // 全上流の出力を収集
        const inputs: NodeOutput[] = []
        for (const srcId of incoming) {
          const out = outputs.get(srcId)
          if (out) inputs.push(out)
        }

        const output = executeMerge(node, inputs)
        outputs.set(nodeId, output)
        nodeStats[nodeId] = {
          cacheHit: false,
          durationMs: performance.now() - nodeStart,
          rowCount: output.rows.length,
        }
        break
      }

      case 'output-v2': {
        const node = entry.node as OutputNodeV2

        // 最初の上流出力を入力として使用
        const firstInput =
          incoming.length > 0 ? outputs.get(incoming[0]) : undefined
        if (!firstInput) {
          return {
            batchResults: {},
            capturedVersions: captureVersionsFn(),
            detailRows: [],
            meta: {
              nodeStats,
              sourceType: 'post',
              totalDurationMs: performance.now() - start,
            },
          }
        }

        const result = executeOutput(db, node, firstInput, options.backendUrls)
        const totalDurationMs = performance.now() - start

        nodeStats[nodeId] = {
          cacheHit: false,
          durationMs: performance.now() - nodeStart,
          rowCount: result.detailRows.length,
        }

        return {
          batchResults: result.batchResults,
          capturedVersions: captureVersionsFn(),
          detailRows: result.detailRows,
          meta: {
            nodeStats,
            sourceType: result.sourceType,
            totalDurationMs,
          },
        }
      }
    }
  }

  // Output ノードに到達しなかった場合のフォールバック
  return {
    batchResults: {},
    capturedVersions: captureVersionsFn(),
    detailRows: [],
    meta: {
      nodeStats,
      sourceType: 'post',
      totalDurationMs: performance.now() - start,
    },
  }
}
