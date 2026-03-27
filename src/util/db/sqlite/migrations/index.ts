/**
 * SQLite マイグレーションランナー (SemVer 対応)
 *
 * - user_version PRAGMA でバージョン管理 (SemVer → 整数エンコード)
 * - フレッシュインストール: createFreshSchema → LATEST_VERSION
 * - インクリメンタル: 各マイグレーションを順次適用
 * - フォールバック: 失敗時は全テーブル DROP → 再作成
 */

import type { SemVer } from '../schema/version'
import {
  compareSemVer,
  encodeSemVer,
  formatSemVer,
  LATEST_VERSION,
  normalizeLegacyVersion,
} from '../schema/version'
import type { SchemaDbHandle as DbHandle } from '../worker/workerSchema'
import type { Migration } from './types'
import { v2_0_0_migration } from './v2.0.0'

export const migrations: Migration[] = [v2_0_0_migration]

export function runMigrations(
  handle: DbHandle,
  dropAllTables: (handle: DbHandle) => void,
  createFreshSchema: (handle: DbHandle) => void,
): void {
  const { db } = handle
  const rawVersion = (
    db.exec('PRAGMA user_version;', { returnValue: 'resultRows' }) as number[][]
  )[0][0]

  const latestEncoded = encodeSemVer(LATEST_VERSION)

  // 1. 最新バージョンなら何もしない
  if (rawVersion === latestEncoded) return

  // 2. 新規 DB
  if (rawVersion === 0) {
    db.exec('BEGIN;')
    try {
      createFreshSchema(handle)
      db.exec(`PRAGMA user_version = ${latestEncoded};`)
      db.exec('COMMIT;')
    } catch (e) {
      db.exec('ROLLBACK;')
      throw e
    }
    return
  }

  // 3. 既存 DB → semver に正規化
  const currentVersion = normalizeLegacyVersion(rawVersion)

  // 4. 適用可能なマイグレーションをフィルタ＆ソート
  const applicable = migrations
    .filter((m) => compareSemVer(m.version, currentVersion) > 0)
    .filter((m) => compareSemVer(m.version, LATEST_VERSION) <= 0)
    .sort((a, b) => compareSemVer(a.version, b.version))

  if (applicable.length === 0) {
    // ギャップ or ダウングレード → フォールバック
    console.warn(
      `SQLite: version mismatch (current: ${formatSemVer(currentVersion)}, latest: ${formatSemVer(LATEST_VERSION)}). Resetting DB.`,
    )
    resetSchema(handle, dropAllTables, createFreshSchema)
    return
  }

  // 5. 各マイグレーションを個別トランザクションで適用
  for (const migration of applicable) {
    const versionStr = formatSemVer(migration.version)
    db.exec('BEGIN;')
    try {
      migration.up(handle)

      if (migration.validate && !migration.validate(handle)) {
        throw new Error(`Migration ${versionStr} validation failed`)
      }

      stampSchemaVersion(db, migration.version, migration.description)

      db.exec(`PRAGMA user_version = ${encodeSemVer(migration.version)};`)
      db.exec('COMMIT;')
      console.info(
        `SQLite: migrated to ${versionStr} (${migration.description})`,
      )
    } catch (e) {
      try {
        db.exec('ROLLBACK;')
      } catch {
        /* ignore rollback error */
      }
      console.warn(
        `SQLite: migration to ${versionStr} failed, resetting DB.`,
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
    db.exec(`PRAGMA user_version = ${encodeSemVer(LATEST_VERSION)};`)
    db.exec('COMMIT;')
  } catch (e2) {
    db.exec('ROLLBACK;')
    throw e2
  }
}

/**
 * schema_version テーブルにバージョン履歴を記録
 */
export function stampSchemaVersion(
  db: DbHandle['db'],
  version: SemVer,
  description: string,
): void {
  try {
    db.exec(
      `INSERT OR REPLACE INTO schema_version (version, applied_at, description)
       VALUES ('${formatSemVer(version)}', ${Date.now()}, '${description.replace(/'/g, "''")}')`,
    )
  } catch {
    // schema_version テーブルがまだ存在しない場合は無視
  }
}
