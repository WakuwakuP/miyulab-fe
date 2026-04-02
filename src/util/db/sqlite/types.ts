/**
 * 新しい DbHandle 型定義
 *
 * Worker モードとフォールバックモードの両方で同一の API を提供する。
 */

import type {
  GraphExecuteOptions,
  GraphExecuteResult,
  SerializedGraphPlan,
} from '../query-ir/executor/types'
import type {
  BindValue,
  FetchTimelineRequest,
  FetchTimelineResult,
  QueryPlanResult,
  SendCommandPayload,
  SerializedExecutionPlan,
} from './protocol'

/** SQL 実行オプション */
export type ExecOpts = {
  bind?: BindValue[]
  returnValue?: 'resultRows'
  /** キュー振り分け: 'timeline' はタイムライン取得キュー（低優先・重複排除あり）、'other' はそれ以外（優先処理） */
  kind?: 'timeline' | 'other'
  /** キャンセル用セッションタグ。同じタグの未処理キューアイテムを cancelStaleRequests で一括除去できる */
  sessionTag?: string
}

/** バッチ SQL ステートメント */
export type BatchStatement = {
  sql: string
  bind?: BindValue[]
  returnValue?: 'resultRows'
}

/** バッチ実行オプション */
export type ExecBatchOpts = {
  rollbackOnError: boolean
  returnIndices?: number[]
}

/**
 * DB 操作ハンドル（Worker モード / フォールバックモード共通）
 */
export type DbHandle = {
  /** 汎用 READ 用 SQL 実行 */
  execAsync: (sql: string, opts?: ExecOpts) => Promise<unknown>

  /** 汎用 READ 用 SQL 実行（実際の SQL 実行時間付き） */
  execAsyncTimed: (
    sql: string,
    opts?: ExecOpts,
  ) => Promise<{ result: unknown; durationMs: number }>

  /** 汎用 WRITE 用バッチ SQL 実行 */
  execBatch: (
    statements: BatchStatement[],
    opts?: ExecBatchOpts,
  ) => Promise<Record<number, unknown>>

  /** 専用ハンドラ呼び出し（Worker に委譲） */
  sendCommand: (command: SendCommandPayload) => Promise<unknown>

  /**
   * 指定した sessionTag を持つ未処理の timeline キューアイテムを除去する。
   * 除去されたアイテムの Promise は staleValue で即時 resolve される。
   * フォールバックモード（キューなし）では no-op (return 0)。
   */
  cancelStaleRequests: (sessionTag: string, staleValue?: unknown) => number

  /**
   * ExecutionPlan を実行する（Plan 003: 汎用実行エンジン）。
   */
  executeQueryPlan: (
    plan: SerializedExecutionPlan,
    sessionTag?: string,
  ) => Promise<QueryPlanResult>

  /**
   * GraphPlan (V2 グラフ) を Worker で実行する。
   * 各ノードを個別実行し、Output ノードで Phase2/Phase3 を構築する。
   */
  executeGraphPlan: (
    plan: SerializedGraphPlan,
    options: GraphExecuteOptions,
    sessionTag?: string,
  ) => Promise<GraphExecuteResult>

  /**
   * タイムラインを一括取得する。
   * Phase1 → Phase2 → Batch×7 を Worker 内で一括実行し、1 回の postMessage で結果を返す。
   */
  fetchTimeline: (
    request: Omit<FetchTimelineRequest, 'type' | 'id'>,
    sessionTag?: string,
  ) => Promise<FetchTimelineResult>

  /** 永続化モード */
  persistence: 'opfs' | 'memory'
}
