/**
 * マイグレーション型定義 (SemVer 対応)
 */

import type { SemVer } from '../schema/version'
import type { SchemaDbHandle as DbHandle } from '../worker/workerSchema'

export type Migration = {
  version: SemVer
  description: string
  up: (handle: DbHandle) => void
  validate?: (handle: DbHandle) => boolean
}
