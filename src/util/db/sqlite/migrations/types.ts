/**
 * マイグレーション型定義
 */
import type { SchemaDbHandle as DbHandle } from '../worker/workerSchema'

export type Migration = {
  version: number
  description: string
  up: (handle: DbHandle) => void
  validate?: (handle: DbHandle) => boolean
}
