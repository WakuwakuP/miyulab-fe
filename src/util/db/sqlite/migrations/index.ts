/**
 * SQLite マイグレーションランナー
 *
 * - user_version PRAGMA でバージョン管理
 * - フレッシュインストール: createFreshSchema → LATEST_VERSION
 * - インクリメンタル: 各マイグレーションを順次適用
 * - フォールバック: 失敗時は全テーブル DROP → 再作成
 */

import type { SchemaDbHandle as DbHandle } from '../worker/workerSchema'
import type { Migration } from './types'
import { v28Migration } from './v28'

const LATEST_VERSION = 28

const migrations: Migration[] = [v28Migration]

export function runMigrations(
  handle: DbHandle,
  dropAllTables: (handle: DbHandle) => void,
  createFreshSchema: (handle: DbHandle) => void,
): void {
  const { db } = handle
  const currentVersion = (
    db.exec('PRAGMA user_version;', { returnValue: 'resultRows' }) as number[][]
  )[0][0]

  if (currentVersion === LATEST_VERSION) return

  if (currentVersion === 0) {
    // フレッシュインストール
    db.exec('BEGIN;')
    try {
      createFreshSchema(handle)
      db.exec(`PRAGMA user_version = ${LATEST_VERSION};`)
      db.exec('COMMIT;')
    } catch (e) {
      db.exec('ROLLBACK;')
      throw e
    }
    return
  }

  // インクリメンタルマイグレーション対象を抽出
  const applicableMigrations = migrations.filter(
    (m) => m.version > currentVersion,
  )

  if (applicableMigrations.length === 0 || currentVersion > LATEST_VERSION) {
    // 不明なバージョン or ダウングレード → フォールバック
    console.warn(
      `SQLite: version mismatch (current: ${currentVersion}, latest: ${LATEST_VERSION}). Resetting DB.`,
    )
    resetSchema(handle, dropAllTables, createFreshSchema)
    return
  }

  // バージョン昇順でソートして順次適用
  applicableMigrations.sort((a, b) => a.version - b.version)

  for (const migration of applicableMigrations) {
    db.exec('BEGIN;')
    try {
      migration.up(handle)

      if (migration.validate && !migration.validate(handle)) {
        throw new Error(`Migration v${migration.version} validation failed`)
      }

      db.exec(`PRAGMA user_version = ${migration.version};`)
      db.exec('COMMIT;')
      console.info(
        `SQLite: migrated to v${migration.version} (${migration.description})`,
      )
    } catch (e) {
      try {
        db.exec('ROLLBACK;')
      } catch {
        /* ignore rollback error */
      }
      console.warn(
        `SQLite: migration to v${migration.version} failed, resetting DB.`,
        e,
      )

      // フォールバック: 全テーブル DROP → 再作成
      resetSchema(handle, dropAllTables, createFreshSchema)
      return
    }
  }
}

/**
 * 全テーブルを DROP して最新スキーマで再作成するフォールバック処理
 */
function resetSchema(
  handle: DbHandle,
  dropAllTables: (handle: DbHandle) => void,
  createFreshSchema: (handle: DbHandle) => void,
): void {
  const { db } = handle
  db.exec('BEGIN;')
  try {
    dropAllTables(handle)
    createFreshSchema(handle)
    db.exec(`PRAGMA user_version = ${LATEST_VERSION};`)
    db.exec('COMMIT;')
  } catch (e2) {
    db.exec('ROLLBACK;')
    throw e2
  }
}
