/**
 * 新しい DbHandle 型定義
 *
 * Worker モードとフォールバックモードの両方で同一の API を提供する。
 */

import type { BindValue, SendCommandPayload } from './protocol'

/** SQL 実行オプション */
export type ExecOpts = {
  bind?: BindValue[]
  returnValue?: 'resultRows'
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

  /** 汎用 WRITE 用バッチ SQL 実行 */
  execBatch: (
    statements: BatchStatement[],
    opts?: ExecBatchOpts,
  ) => Promise<Record<number, unknown>>

  /** 専用ハンドラ呼び出し（Worker に委譲） */
  sendCommand: (command: SendCommandPayload) => Promise<unknown>

  /** 永続化モード */
  persistence: 'opfs' | 'memory'
}
