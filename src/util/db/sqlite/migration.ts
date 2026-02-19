/**
 * IndexedDB → SQLite マイグレーション
 *
 * 初回起動時に IndexedDB (Dexie) のデータを SQLite に移行する。
 * マイグレーション完了後はフラグを立て、再実行しない。
 *
 * Worker モードでは Dexie の読み取りはメインスレッドで行い、
 * SQLite への書き込みは sendCommand('migrationWrite') で Worker に委譲する。
 */

import { db as dexieDb } from '../database'
import { getSqliteDb } from './connection'
import type {
  MigrationNotificationBatch,
  MigrationStatusBatch,
} from './protocol'

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
 *
 * Dexie の読み取りはメインスレッドで行い、
 * バッチ単位で Worker に migrationWrite コマンドを送信する。
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

      const statusBatches: MigrationStatusBatch[] = batch.map((s) => {
        const {
          backendUrl,
          belongingTags,
          compositeKey,
          created_at_ms,
          storedAt,
          timelineTypes,
          ...entityStatus
        } = s

        return {
          backendUrl,
          belongingTags,
          compositeKey,
          created_at_ms,
          entityJson: JSON.stringify(entityStatus),
          storedAt,
          timelineTypes,
        }
      })

      await handle.sendCommand({
        notificationBatches: [],
        statusBatches,
        type: 'migrationWrite',
      })

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

      const notificationBatches: MigrationNotificationBatch[] = batch.map(
        (n) => {
          const {
            backendUrl,
            compositeKey,
            created_at_ms,
            storedAt,
            ...entity
          } = n

          return {
            backendUrl,
            compositeKey,
            created_at_ms,
            entityJson: JSON.stringify(entity),
            storedAt,
          }
        },
      )

      await handle.sendCommand({
        notificationBatches,
        statusBatches: [],
        type: 'migrationWrite',
      })

      offset += batch.length
      console.info(
        `Migration progress: ${Math.min(offset, notifCount)}/${notifCount} notifications migrated...`,
      )
    }

    markMigrated()

    console.info('Migration from IndexedDB to SQLite completed successfully.')
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
