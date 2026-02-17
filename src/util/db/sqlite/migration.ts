/**
 * IndexedDB → SQLite マイグレーション
 *
 * 初回起動時に IndexedDB (Dexie) のデータを SQLite に移行する。
 * マイグレーション完了後はフラグを立て、再実行しない。
 */

import { db as dexieDb } from '../database'
import { getSqliteDb, notifyChange } from './connection'

const MIGRATION_KEY = 'miyulab-fe:sqlite-migrated'

/**
 * マイグレーション済みかどうかを返す
 */
export function isMigrated(): boolean {
  if (typeof localStorage === 'undefined') return true
  return localStorage.getItem(MIGRATION_KEY) === '1'
}

/**
 * IndexedDB → SQLite のデータマイグレーションを実行する
 *
 * - Dexie が空ならスキップ
 * - 既にマイグレーション済みならスキップ
 */
export async function migrateFromIndexedDb(): Promise<void> {
  if (isMigrated()) return

  try {
    // Dexie DB を開く（存在しない場合は空テーブルが返る）
    const statusCount = await dexieDb.statuses.count()
    const notifCount = await dexieDb.notifications.count()

    if (statusCount === 0 && notifCount === 0) {
      // IndexedDB にデータがない → マイグレーション不要
      markMigrated()
      return
    }

    console.info(
      `Migrating ${statusCount} statuses and ${notifCount} notifications from IndexedDB to SQLite...`,
    )

    const handle = await getSqliteDb()
    const { db } = handle

    // ---- statuses ----
    const BATCH_SIZE = 500
    let offset = 0

    while (true) {
      const batch = await dexieDb.statuses
        .toCollection()
        .offset(offset)
        .limit(BATCH_SIZE)
        .toArray()

      if (batch.length === 0) break

      db.exec('BEGIN;')
      try {
        for (const s of batch) {
          // Entity.Status 部分を抽出（インデックスフィールドを除外）
          const {
            backendUrl,
            belongingTags,
            compositeKey,
            created_at_ms,
            storedAt,
            timelineTypes,
            ...entityStatus
          } = s

          db.exec(
            `INSERT OR REPLACE INTO statuses (compositeKey, backendUrl, created_at_ms, storedAt, json)
             VALUES (?, ?, ?, ?, ?);`,
            {
              bind: [
                compositeKey,
                backendUrl,
                created_at_ms,
                storedAt,
                JSON.stringify(entityStatus),
              ],
            },
          )

          for (const tt of timelineTypes) {
            db.exec(
              `INSERT OR IGNORE INTO statuses_timeline_types (compositeKey, timelineType)
               VALUES (?, ?);`,
              { bind: [compositeKey, tt] },
            )
          }

          for (const tag of belongingTags) {
            db.exec(
              `INSERT OR IGNORE INTO statuses_belonging_tags (compositeKey, tag)
               VALUES (?, ?);`,
              { bind: [compositeKey, tag] },
            )
          }
        }
        db.exec('COMMIT;')
      } catch (e) {
        db.exec('ROLLBACK;')
        throw e
      }

      offset += batch.length
      console.info(
        `Migration progress: ${Math.min(offset, statusCount)}/${statusCount} statuses migrated...`,
      )
    }

    // ---- notifications ----
    offset = 0
    while (true) {
      const batch = await dexieDb.notifications
        .toCollection()
        .offset(offset)
        .limit(BATCH_SIZE)
        .toArray()

      if (batch.length === 0) break

      db.exec('BEGIN;')
      try {
        for (const n of batch) {
          const {
            backendUrl,
            compositeKey,
            created_at_ms,
            storedAt,
            ...entity
          } = n

          db.exec(
            `INSERT OR REPLACE INTO notifications (compositeKey, backendUrl, created_at_ms, storedAt, json)
             VALUES (?, ?, ?, ?, ?);`,
            {
              bind: [
                compositeKey,
                backendUrl,
                created_at_ms,
                storedAt,
                JSON.stringify(entity),
              ],
            },
          )
        }
        db.exec('COMMIT;')
      } catch (e) {
        db.exec('ROLLBACK;')
        throw e
      }

      offset += batch.length
      console.info(
        `Migration progress: ${Math.min(offset, notifCount)}/${notifCount} notifications migrated...`,
      )
    }

    markMigrated()

    console.info('Migration from IndexedDB to SQLite completed successfully.')
    notifyChange('statuses')
    notifyChange('notifications')
  } catch (error) {
    console.error('Migration from IndexedDB to SQLite failed:', error)
    // マイグレーション失敗時はフラグを立てない（次回再試行）
    throw error
  }
}

function markMigrated(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(MIGRATION_KEY, '1')
  }
}
