/**
 * workerClient 内部で使用する型定義
 */

import type { QueueKind } from '../../dbQueue'

export type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  kind: QueueKind
  timer: ReturnType<typeof setTimeout>
}

export type QueuedRequest = {
  message: { type: string; id: number; [key: string]: unknown }
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  kind: QueueKind
  sessionTag?: string
}
