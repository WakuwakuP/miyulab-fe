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

function getLastInsertRowId(db: DbExec): number {
  return (
    db.exec('SELECT last_insert_rowid();', {
      returnValue: 'resultRows',
    }) as number[][]
  )[0][0]
}

function upsertMentionsInternal(
  db: DbExec,
  postId: number,
  mentions: Entity.Mention[],
): void {
  db.exec('DELETE FROM posts_mentions WHERE post_id = ?;', {
    bind: [postId],
  })
  for (const mention of mentions) {
    db.exec(
      'INSERT OR IGNORE INTO posts_mentions (post_id, acct) VALUES (?, ?);',
      { bind: [postId, mention.acct] },
    )
  }
}

export function handleMigrationWrite(
  db: DbExec,
  statusBatches: MigrationStatusBatch[],
  notificationBatches: MigrationNotificationBatch[],
): HandlerResult {
  const changedTables: TableName[] = []

  // ---- statuses → posts ----
  if (statusBatches.length > 0) {
    db.exec('BEGIN;')
    try {
      for (const s of statusBatches) {
        const entityStatus = JSON.parse(s.entityJson) as Entity.Status
        const cols = extractStatusColumns(entityStatus)
        // compositeKey から local_id を抽出
        const localId = s.compositeKey.slice(s.backendUrl.length + 1)

        // URI ベースの重複排除
        let postId: number | undefined
        const uri = entityStatus.uri
        if (uri) {
          const existingRows = db.exec(
            'SELECT post_id FROM posts WHERE object_uri = ?;',
            { bind: [uri], returnValue: 'resultRows' },
          ) as number[][]
          if (existingRows.length > 0) {
            postId = existingRows[0][0]
          }
        }

        // posts_backends でも検索
        if (postId === undefined) {
          const pbRows = db.exec(
            'SELECT post_id FROM posts_backends WHERE backendUrl = ? AND local_id = ?;',
            { bind: [s.backendUrl, localId], returnValue: 'resultRows' },
          ) as number[][]
          if (pbRows.length > 0) {
            postId = pbRows[0][0]
          }
        }

        if (postId !== undefined) {
          db.exec(
            `UPDATE posts SET
              stored_at        = ?,
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
            WHERE post_id = ?;`,
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
                postId,
              ],
            },
          )
        } else {
          db.exec(
            `INSERT INTO posts (
              origin_backend_url, created_at_ms, stored_at,
              object_uri, reblog_of_uri,
              account_acct, account_id, visibility, language,
              has_media, media_count, is_reblog, reblog_of_id,
              is_sensitive, has_spoiler, in_reply_to_id,
              favourites_count, reblogs_count, replies_count,
              json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            {
              bind: [
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
          postId = getLastInsertRowId(db)
        }

        // posts_backends
        db.exec(
          `INSERT OR IGNORE INTO posts_backends (post_id, backendUrl, local_id)
           VALUES (?, ?, ?);`,
          { bind: [postId, s.backendUrl, localId] },
        )

        // timeline_types
        for (const tt of s.timelineTypes) {
          db.exec(
            `INSERT OR IGNORE INTO posts_timeline_types (post_id, timelineType)
             VALUES (?, ?);`,
            { bind: [postId, tt] },
          )
        }

        // belonging_tags
        for (const tag of s.belongingTags) {
          db.exec(
            `INSERT OR IGNORE INTO posts_belonging_tags (post_id, tag)
             VALUES (?, ?);`,
            { bind: [postId, tag] },
          )
        }

        // mentions
        if (entityStatus.mentions && entityStatus.mentions.length > 0) {
          upsertMentionsInternal(db, postId, entityStatus.mentions)
        }

        // reblogs（元投稿の URI が存在する場合のみ）
        if (cols.is_reblog === 1 && cols.reblog_of_uri) {
          db.exec(
            `INSERT OR REPLACE INTO posts_reblogs (post_id, original_uri, reblogger_acct, reblogged_at_ms)
             VALUES (?, ?, ?, ?);`,
            {
              bind: [
                postId,
                cols.reblog_of_uri,
                cols.account_acct,
                s.created_at_ms,
              ],
            },
          )
        }
      }
      db.exec('COMMIT;')
    } catch (e) {
      db.exec('ROLLBACK;')
      throw e
    }
    changedTables.push('posts')
  }

  // ---- notifications ----
  if (notificationBatches.length > 0) {
    db.exec('BEGIN;')
    try {
      for (const n of notificationBatches) {
        const entity = JSON.parse(n.entityJson) as Entity.Notification
        const cols = extractNotificationColumns(entity)
        const localId = n.compositeKey.slice(n.backendUrl.length + 1)

        // (backend_url, local_id) で既存チェック
        const existing = db.exec(
          'SELECT notification_id FROM notifications WHERE backend_url = ? AND local_id = ?;',
          { bind: [n.backendUrl, localId], returnValue: 'resultRows' },
        ) as number[][]

        if (existing.length > 0) {
          db.exec(
            `UPDATE notifications SET
              created_at_ms     = ?,
              stored_at         = ?,
              notification_type = ?,
              status_id         = ?,
              account_acct      = ?,
              json              = ?
            WHERE notification_id = ?;`,
            {
              bind: [
                n.created_at_ms,
                n.storedAt,
                cols.notification_type,
                cols.status_id,
                cols.account_acct,
                n.entityJson,
                existing[0][0],
              ],
            },
          )
        } else {
          db.exec(
            `INSERT INTO notifications (
              backend_url, local_id, created_at_ms, stored_at,
              notification_type, status_id, account_acct,
              json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
            {
              bind: [
                n.backendUrl,
                localId,
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
