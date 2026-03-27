import { runMigrations } from '../migrations'
import type { SchemaDbHandle } from '../worker/workerSchema'
import { createAccountTables } from './tables/accounts'
import { createCardTables } from './tables/cards'
import { createInteractionTables } from './tables/interactions'
import { createLookupTables } from './tables/lookup'
import { createMetaTables } from './tables/meta'
import { createNotificationTables } from './tables/notifications'
import { createPollTables } from './tables/polls'
import { createPostRelatedTables } from './tables/postRelated'
import { createPostTables } from './tables/posts'
import { createProfileTables } from './tables/profiles'
import { createRegistryTables } from './tables/registries'
import { createTimelineTables } from './tables/timeline'

/** DB スキーマの初期化（Worker 起動時に呼ばれる） */
export function ensureSchema(handle: SchemaDbHandle): void {
  runMigrations(handle, dropAllTables, createFreshSchema)
}

/**
 * 最新スキーマを直接作成する（新規 DB 用）。
 * FK 依存順に全テーブルを作成する。
 */
export function createFreshSchema(handle: SchemaDbHandle): void {
  const { db } = handle

  // 1. 参照先テーブル（ルックアップ + マスタ）
  createLookupTables(db)
  createRegistryTables(db)

  // 2. アカウント・プロフィール
  createProfileTables(db)
  createAccountTables(db)

  // 3. 投稿関連
  createPostTables(db)
  createPostRelatedTables(db)
  createInteractionTables(db)
  createPollTables(db)
  createCardTables(db)

  // 4. フィード・通知
  createTimelineTables(db)
  createNotificationTables(db)

  // 5. メタ
  createMetaTables(db)
}

/** 全テーブルを DROP する（リセット用） */
export function dropAllTables(handle: SchemaDbHandle): void {
  const { db } = handle
  const rows = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",
    { returnValue: 'resultRows' },
  ) as string[][]
  db.exec('PRAGMA foreign_keys = OFF;')
  for (const [name] of rows) {
    db.exec(`DROP TABLE IF EXISTS "${name}";`)
  }
  db.exec('PRAGMA foreign_keys = ON;')
}
