// ============================================================
// Graph Executor — 型定義
//
// Worker 内でグラフベースの QueryPlanV2 を実行するための
// コマンド・結果・内部型を定義する。
// ============================================================

import type { NodeOutputRow } from '../plan'

// --------------- ノード出力 ---------------

/**
 * 各ノードの実行結果。
 * 行データ `[{id, createdAtMs}]` とメタデータを保持する。
 */
export type NodeOutput = {
  /** 出力行 — 常に id + createdAtMs のペア */
  rows: NodeOutputRow[]
  /** この出力の元テーブル ('posts' | 'notifications' 等) */
  sourceTable: string
  /** キャッシュキー用のコンテンツハッシュ */
  hash: string
}

// --------------- ノード実行統計 ---------------

/** 各ノードの実行統計（デバッグ・UI表示用） */
export type NodeStat = {
  durationMs: number
  rowCount: number
  cacheHit: boolean
}

// --------------- Worker コマンド ---------------

/**
 * グラフ実行コマンド (Main Thread → Worker)
 *
 * QueryPlanV2 をそのまま Worker に送り、Worker 内で
 * トポロジカルソート → 各ノード実行 → Output の Phase2/3 を行う。
 */
export type ExecuteGraphPlanRequest = {
  type: 'executeGraphPlan'
  id: number
  /** QueryPlanV2 をシリアライズした形式 */
  plan: SerializedGraphPlan
  options: GraphExecuteOptions
}

/** シリアライズされたグラフプラン */
export type SerializedGraphPlan = {
  version: 2
  nodes: SerializedGraphNode[]
  edges: { source: string; target: string }[]
  legacyV1Overlay?: {
    filters: unknown[]
  }
}

/** シリアライズされたノード */
export type SerializedGraphNode = {
  id: string
  node: SerializedNodeData
}

/**
 * ノードデータの union 型。
 * QueryPlanV2 の各ノード型をそのまま保持する。
 */
export type SerializedNodeData =
  | SerializedGetIdsNode
  | SerializedLookupRelatedNode
  | SerializedMergeNode
  | SerializedOutputNode

export type SerializedGetIdsNode = {
  kind: 'get-ids'
  table: string
  filters: SerializedGetIdsFilter[]
  orBranches?: SerializedGetIdsFilter[][]
  outputIdColumn?: string
  outputTimeColumn?: string | null
  inputBindings?: { column: string; sourceNodeId: string }[]
}

export type SerializedGetIdsFilter =
  | {
      table: string
      column: string
      op: string
      value?: unknown
    }
  | {
      table: string
      mode: string
      countValue?: number
      innerFilters?: {
        table: string
        column: string
        op: string
        value?: unknown
      }[]
    }

export type SerializedLookupRelatedNode = {
  kind: 'lookup-related'
  lookupTable: string
  joinConditions: {
    inputColumn: string
    lookupColumn: string
    resolve?: {
      via: string
      inputKey: string
      lookupKey: string
      matchColumn: string
    }
  }[]
  timeCondition?: {
    lookupTimeColumn: string
    inputTimeColumn: string
    afterInput: boolean
    windowMs: number
  }
  aggregate?: {
    column: string
    function: 'MIN' | 'MAX'
  }
}

export type SerializedMergeNode = {
  kind: 'merge-v2'
  strategy: 'union' | 'intersect' | 'interleave-by-time'
  limit: number
}

export type SerializedOutputNode = {
  kind: 'output-v2'
  sort: { field: string; direction: 'ASC' | 'DESC' }
  pagination: { limit: number; offset?: number }
}

/** 実行オプション */
export type GraphExecuteOptions = {
  /** バックエンドURL一覧 (Phase2 scoped query 用) */
  backendUrls: string[]
}

// --------------- Worker 結果 ---------------

/**
 * グラフ実行結果 (Worker → Main Thread)
 *
 * Output ノードが構築した Phase2/Phase3 の結果と
 * 各ノードの実行統計を返す。
 * posts と notifications は別々に格納され、displayOrder で表示順序を保持する。
 */
export type GraphExecuteResult = {
  /** Post の Phase2 詳細データ行 + Phase3 バッチエンリッチメント */
  posts: {
    detailRows: (string | number | null)[][]
    batchResults: Record<string, (string | number | null)[][]>
  }
  /** Notification の詳細データ行 */
  notifications: {
    detailRows: (string | number | null)[][]
  }
  /** 表示順序 — (table, id) ペアの配列 (sort 適用済み) */
  displayOrder: DisplayOrderEntry[]
  /** メタ情報 */
  meta: {
    sourceType: 'post' | 'notification' | 'mixed'
    totalDurationMs: number
    /** 各ノードの実行統計 (nodeId → stats) */
    nodeStats: Record<string, NodeStat>
  }
  /** 各ノードの中間出力 ID (nodeId → {table, id}[]) */
  nodeOutputIds: Record<string, DisplayOrderEntry[]>
  /** テーブルバージョンスナップショット（キャッシュ検証用） */
  capturedVersions: Record<string, number>
}

/** displayOrder の各エントリ */
export type DisplayOrderEntry = {
  table: 'posts' | 'notifications'
  id: number
}
