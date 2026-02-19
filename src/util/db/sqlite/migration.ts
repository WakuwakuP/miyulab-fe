/**
 * IndexedDB → SQLite マイグレーション
 *
 * 初回起動時に IndexedDB (Dexie) のデータを SQLite に移行する。
 * マイグレーション完了後はフラグを立て、再実行しない。
 *
 * v2 スキーマ対応: マイグレーション時に正規化カラムも同時に書き込む。
 * v3 スキーマ対応: uri / reblog_of_uri カラムと statuses_backends テーブルにも書き込む。
 * これにより、マイグレーション後にバックフィルを実行する必要がなくなる。
 */

import type { Entity } from 'megalodon'
import { db as dexieDb } from '../database'
import { getSqliteDb, notifyChange } from './connection'
import { extractNotificationColumns } from './notificationStore'
import { extractStatusColumns, upsertMentions } from './statusStore'

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
 * v2 スキーマ対応:
 * - statuses: 正規化カラム (account_acct, visibility, has_media 等) を同時に書き込む
 * - statuses_mentions: メンション情報を statuses_mentions テーブルに書き込む
 * - notifications: 正規化カラム (notification_type, status_id, account_acct) を同時に書き込む
 *
 * v3 スキーマ対応:
 * - statuses: uri / reblog_of_uri カラムを同時に書き込む
 * - statuses_backends: 投稿 × バックエンドの多対多関連を書き込む
 * - URI ベースの重複排除により、同一投稿は1行に集約される
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

      await handle.exec('BEGIN;')
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

          // v2 + v3 正規化カラムを抽出
          const cols = extractStatusColumns(entityStatus as Entity.Status)
          const status = entityStatus as Entity.Status

          // v3: URI ベースの重複排除
          // 同一 URI の投稿が既に存在する場合は既存の compositeKey を再利用
          let effectiveCompositeKey = compositeKey
          const uri = status.uri
          if (uri) {
            const existingRows = (await handle.exec(
              'SELECT compositeKey FROM statuses WHERE uri = ?;',
              { bind: [uri], returnValue: 'resultRows' },
            )) as string[][]
            if (existingRows.length > 0) {
              effectiveCompositeKey = existingRows[0][0]
            }
          }

          if (effectiveCompositeKey !== compositeKey) {
            // 既存行を更新
            await handle.exec(
              `UPDATE statuses SET
                storedAt         = ?,
                account_acct     = ?,
                account_id       = ?,
                visibility       = ?,
                language         = ?,
                has_media        = ?,
                media_count      = ?,
                is_reblog        = ?,
                reblog_of_id     = ?,
                reblog_of_uri    = ?,
                is_sensitive     = ?,
                has_spoiler      = ?,
                in_reply_to_id   = ?,
                favourites_count = ?,
                reblogs_count    = ?,
                replies_count    = ?,
                json             = ?
              WHERE compositeKey = ?;`,
              {
                bind: [
                  storedAt,
                  cols.account_acct,
                  cols.account_id,
                  cols.visibility,
                  cols.language,
                  cols.has_media,
                  cols.media_count,
                  cols.is_reblog,
                  cols.reblog_of_id,
                  cols.reblog_of_uri,
                  cols.is_sensitive,
                  cols.has_spoiler,
                  cols.in_reply_to_id,
                  cols.favourites_count,
                  cols.reblogs_count,
                  cols.replies_count,
                  JSON.stringify(entityStatus),
                  effectiveCompositeKey,
                ],
              },
            )
          } else {
            // 新規行を INSERT
            await handle.exec(
              `INSERT OR REPLACE INTO statuses (
                compositeKey, backendUrl, created_at_ms, storedAt,
                uri, reblog_of_uri,
                account_acct, account_id, visibility, language,
                has_media, media_count, is_reblog, reblog_of_id,
                is_sensitive, has_spoiler, in_reply_to_id,
                favourites_count, reblogs_count, replies_count,
                json
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
              {
                bind: [
                  compositeKey,
                  backendUrl,
                  created_at_ms,
                  storedAt,
                  cols.uri,
                  cols.reblog_of_uri,
                  cols.account_acct,
                  cols.account_id,
                  cols.visibility,
                  cols.language,
                  cols.has_media,
                  cols.media_count,
                  cols.is_reblog,
                  cols.reblog_of_id,
                  cols.is_sensitive,
                  cols.has_spoiler,
                  cols.in_reply_to_id,
                  cols.favourites_count,
                  cols.reblogs_count,
                  cols.replies_count,
                  JSON.stringify(entityStatus),
                ],
              },
            )
          }

          // v3: statuses_backends に登録
          await handle.exec(
            `INSERT OR IGNORE INTO statuses_backends (compositeKey, backendUrl, local_id)
             VALUES (?, ?, ?);`,
            { bind: [effectiveCompositeKey, backendUrl, status.id] },
          )

          for (const tt of timelineTypes) {
            await handle.exec(
              `INSERT OR IGNORE INTO statuses_timeline_types (compositeKey, timelineType)
               VALUES (?, ?);`,
              { bind: [effectiveCompositeKey, tt] },
            )
          }

          for (const tag of belongingTags) {
            await handle.exec(
              `INSERT OR IGNORE INTO statuses_belonging_tags (compositeKey, tag)
               VALUES (?, ?);`,
              { bind: [effectiveCompositeKey, tag] },
            )
          }

          // v2: メンション情報を statuses_mentions テーブルに書き込む
          if (status.mentions && status.mentions.length > 0) {
            await upsertMentions(handle, effectiveCompositeKey, status.mentions)
          }
        }
        await handle.exec('COMMIT;')
      } catch (e) {
        await handle.exec('ROLLBACK;')
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

      await handle.exec('BEGIN;')
      try {
        for (const n of batch) {
          const {
            backendUrl,
            compositeKey,
            created_at_ms,
            storedAt,
            ...entity
          } = n

          // v2 + v3 正規化カラムを抽出
          const cols = extractNotificationColumns(entity as Entity.Notification)

          await handle.exec(
            `INSERT OR REPLACE INTO notifications (
              compositeKey, backendUrl, created_at_ms, storedAt,
              notification_type, status_id, account_acct,
              json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
            {
              bind: [
                compositeKey,
                backendUrl,
                created_at_ms,
                storedAt,
                cols.notification_type,
                cols.status_id,
                cols.account_acct,
                JSON.stringify(entity),
              ],
            },
          )
        }
        await handle.exec('COMMIT;')
      } catch (e) {
        await handle.exec('ROLLBACK;')
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
