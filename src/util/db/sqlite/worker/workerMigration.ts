/**
 * Worker 側: マイグレーションデータ書き込み (v13 スキーマ対応)
 */

import type { Entity } from 'megalodon'
import type {
  MigrationNotificationBatch,
  MigrationStatusBatch,
  TableName,
} from '../protocol'
import {
  ensureProfile,
  ensureServer,
  ensureTimeline,
  extractStatusColumns,
  resolvePostId,
  resolvePostItemKindId,
} from '../shared'

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

function resolveVisibilityId(db: DbExec, visibility: string): number | null {
  const rows = db.exec(
    'SELECT visibility_id FROM visibility_types WHERE code = ?;',
    { bind: [visibility], returnValue: 'resultRows' },
  ) as number[][]
  return rows.length > 0 ? rows[0][0] : null
}

function resolveNotificationTypeId(
  db: DbExec,
  notificationType: string,
): number | null {
  const rows = db.exec(
    'SELECT notification_type_id FROM notification_types WHERE code = ?;',
    { bind: [notificationType], returnValue: 'resultRows' },
  ) as number[][]
  return rows.length > 0 ? rows[0][0] : null
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

        const serverId = ensureServer(db, s.backendUrl)
        const visibilityId = resolveVisibilityId(db, cols.visibility)
        const profileId = ensureProfile(db, entityStatus.account)

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
          postId = resolvePostId(db, s.backendUrl, localId) ?? undefined
        }

        if (postId !== undefined) {
          db.exec(
            `UPDATE posts SET
              stored_at          = ?,
              author_profile_id  = ?,
              visibility_id      = ?,
              language           = ?,
              content_html       = ?,
              spoiler_text       = ?,
              canonical_url      = ?,
              has_media          = ?,
              media_count        = ?,
              is_reblog          = ?,
              reblog_of_uri      = ?,
              is_sensitive       = ?,
              has_spoiler        = ?,
              in_reply_to_id     = ?,
              edited_at          = ?
            WHERE post_id = ?;`,
            {
              bind: [
                s.storedAt,
                profileId,
                visibilityId,
                cols.language,
                cols.content_html,
                cols.spoiler_text,
                cols.canonical_url,
                cols.has_media,
                cols.media_count,
                cols.is_reblog,
                cols.reblog_of_uri,
                cols.is_sensitive,
                cols.has_spoiler,
                cols.in_reply_to_id,
                cols.edited_at,
                postId,
              ],
            },
          )
        } else {
          db.exec(
            `INSERT INTO posts (
              object_uri, origin_server_id, created_at_ms, stored_at,
              author_profile_id, visibility_id, language,
              content_html, spoiler_text, canonical_url,
              has_media, media_count, is_reblog, reblog_of_uri,
              is_sensitive, has_spoiler, in_reply_to_id,
              is_local_only, edited_at
            ) VALUES (?,?,?,?, ?,?,?, ?,?,?, ?,?,?,?, ?,?,?, ?,?);`,
            {
              bind: [
                cols.uri,
                serverId,
                s.created_at_ms,
                s.storedAt,
                profileId,
                visibilityId,
                cols.language,
                cols.content_html,
                cols.spoiler_text,
                cols.canonical_url,
                cols.has_media,
                cols.media_count,
                cols.is_reblog,
                cols.reblog_of_uri,
                cols.is_sensitive,
                cols.has_spoiler,
                cols.in_reply_to_id,
                0,
                cols.edited_at,
              ],
            },
          )
          postId = getLastInsertRowId(db)
        }

        // posts_backends
        db.exec(
          `INSERT OR IGNORE INTO posts_backends (post_id, backendUrl, local_id, server_id)
           VALUES (?, ?, ?, ?);`,
          { bind: [postId, s.backendUrl, localId, serverId] },
        )

        // timeline_items
        const postItemKindId = resolvePostItemKindId(db)
        for (const tt of s.timelineTypes) {
          const timelineId = ensureTimeline(db, serverId, tt)
          db.exec(
            `INSERT OR IGNORE INTO timeline_items (timeline_id, timeline_item_kind_id, post_id, sort_key, inserted_at)
             VALUES (?, ?, ?, ?, ?);`,
            {
              bind: [
                timelineId,
                postItemKindId,
                postId,
                s.created_at_ms,
                s.storedAt,
              ],
            },
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
                entityStatus.account.acct,
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
        const localId = n.compositeKey.slice(n.backendUrl.length + 1)

        const serverId = ensureServer(db, n.backendUrl)
        const notificationTypeId = resolveNotificationTypeId(db, entity.type)
        const actorProfileId = entity.account
          ? ensureProfile(db, entity.account)
          : null
        const relatedPostId = entity.status
          ? resolvePostId(db, n.backendUrl, entity.status.id)
          : null

        // (server_id, local_id) で既存チェック
        const existing = db.exec(
          'SELECT notification_id FROM notifications WHERE server_id = ? AND local_id = ?;',
          { bind: [serverId, localId], returnValue: 'resultRows' },
        ) as number[][]

        if (existing.length > 0) {
          db.exec(
            `UPDATE notifications SET
              notification_type_id = ?,
              actor_profile_id     = ?,
              related_post_id      = ?,
              created_at_ms        = ?,
              stored_at            = ?
            WHERE notification_id = ?;`,
            {
              bind: [
                notificationTypeId,
                actorProfileId,
                relatedPostId,
                n.created_at_ms,
                n.storedAt,
                existing[0][0],
              ],
            },
          )
        } else {
          db.exec(
            `INSERT INTO notifications (
              server_id, local_id, notification_type_id, actor_profile_id,
              related_post_id, created_at_ms, stored_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
            {
              bind: [
                serverId,
                localId,
                notificationTypeId,
                actorProfileId,
                relatedPostId,
                n.created_at_ms,
                n.storedAt,
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
