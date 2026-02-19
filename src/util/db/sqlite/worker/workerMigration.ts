/**
 * Worker 側: マイグレーションデータ書き込み
 */

import type { Entity } from 'megalodon'
import type {
  MigrationNotificationBatch,
  MigrationStatusBatch,
  TableName,
} from '../protocol'
import { extractNotificationColumns, extractStatusColumns } from '../shared'

type DbExec = {
  exec: (
    sql: string,
    opts?: {
      bind?: (string | number | null)[]
      returnValue?: 'resultRows'
    },
  ) => unknown
}

type HandlerResult = { changedTables: TableName[] }

function upsertMentionsInternal(
  db: DbExec,
  compositeKey: string,
  mentions: Entity.Mention[],
): void {
  db.exec('DELETE FROM statuses_mentions WHERE compositeKey = ?;', {
    bind: [compositeKey],
  })
  for (const mention of mentions) {
    db.exec(
      'INSERT OR IGNORE INTO statuses_mentions (compositeKey, acct) VALUES (?, ?);',
      { bind: [compositeKey, mention.acct] },
    )
  }
}

export function handleMigrationWrite(
  db: DbExec,
  statusBatches: MigrationStatusBatch[],
  notificationBatches: MigrationNotificationBatch[],
): HandlerResult {
  const changedTables: TableName[] = []

  // ---- statuses ----
  if (statusBatches.length > 0) {
    db.exec('BEGIN;')
    try {
      for (const s of statusBatches) {
        const entityStatus = JSON.parse(s.entityJson) as Entity.Status
        const cols = extractStatusColumns(entityStatus)

        // URI ベースの重複排除
        let effectiveCompositeKey = s.compositeKey
        const uri = entityStatus.uri
        if (uri) {
          const existingRows = db.exec(
            'SELECT compositeKey FROM statuses WHERE uri = ?;',
            { bind: [uri], returnValue: 'resultRows' },
          ) as string[][]
          if (existingRows.length > 0) {
            effectiveCompositeKey = existingRows[0][0]
          }
        }

        if (effectiveCompositeKey !== s.compositeKey) {
          db.exec(
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
                s.storedAt,
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
                s.entityJson,
                effectiveCompositeKey,
              ],
            },
          )
        } else {
          db.exec(
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
                s.compositeKey,
                s.backendUrl,
                s.created_at_ms,
                s.storedAt,
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
                s.entityJson,
              ],
            },
          )
        }

        // statuses_backends
        db.exec(
          `INSERT OR IGNORE INTO statuses_backends (compositeKey, backendUrl, local_id)
           VALUES (?, ?, ?);`,
          { bind: [effectiveCompositeKey, s.backendUrl, entityStatus.id] },
        )

        // timeline_types
        for (const tt of s.timelineTypes) {
          db.exec(
            `INSERT OR IGNORE INTO statuses_timeline_types (compositeKey, timelineType)
             VALUES (?, ?);`,
            { bind: [effectiveCompositeKey, tt] },
          )
        }

        // belonging_tags
        for (const tag of s.belongingTags) {
          db.exec(
            `INSERT OR IGNORE INTO statuses_belonging_tags (compositeKey, tag)
             VALUES (?, ?);`,
            { bind: [effectiveCompositeKey, tag] },
          )
        }

        // mentions
        if (entityStatus.mentions && entityStatus.mentions.length > 0) {
          upsertMentionsInternal(
            db,
            effectiveCompositeKey,
            entityStatus.mentions,
          )
        }
      }
      db.exec('COMMIT;')
    } catch (e) {
      db.exec('ROLLBACK;')
      throw e
    }
    changedTables.push('statuses')
  }

  // ---- notifications ----
  if (notificationBatches.length > 0) {
    db.exec('BEGIN;')
    try {
      for (const n of notificationBatches) {
        const entity = JSON.parse(n.entityJson) as Entity.Notification
        const cols = extractNotificationColumns(entity)

        db.exec(
          `INSERT OR REPLACE INTO notifications (
            compositeKey, backendUrl, created_at_ms, storedAt,
            notification_type, status_id, account_acct,
            json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
          {
            bind: [
              n.compositeKey,
              n.backendUrl,
              n.created_at_ms,
              n.storedAt,
              cols.notification_type,
              cols.status_id,
              cols.account_acct,
              n.entityJson,
            ],
          },
        )
      }
      db.exec('COMMIT;')
    } catch (e) {
      db.exec('ROLLBACK;')
      throw e
    }
    changedTables.push('notifications')
  }

  return { changedTables }
}
