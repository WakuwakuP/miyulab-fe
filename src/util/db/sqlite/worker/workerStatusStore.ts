/**
 * Worker 側: Status 関連のトランザクション処理
 *
 * 現行 statusStore.ts のビジネスロジックを Worker 内で実行する純粋関数群。
 * 生の Database オブジェクトを引数に取り、フォールバックモードからも直接呼べる。
 */

import type { Entity } from 'megalodon'
import type { TableName } from '../protocol'
import {
  ACTION_TO_ENGAGEMENT,
  ensureProfile,
  ensureServer,
  ensureTimeline,
  extractStatusColumns,
  resolveLocalAccountId,
  resolvePostId,
  resolvePostItemKindId,
  toggleEngagement,
} from '../shared'

// ================================================================
// 内部型（Worker / フォールバック共通）
// ================================================================

/** db.exec 互換の最小インターフェース */
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

// ================================================================
// 内部ヘルパー
// ================================================================

function resolvePostIdInternal(
  db: DbExec,
  backendUrl: string,
  localId: string,
): number | null {
  return resolvePostId(db, backendUrl, localId)
}

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

function resolveMediaTypeId(db: DbExec, mediaType: string): number {
  const rows = db.exec(
    'SELECT media_type_id FROM media_types WHERE code = ?;',
    { bind: [mediaType], returnValue: 'resultRows' },
  ) as number[][]
  if (rows.length > 0) return rows[0][0]
  // フォールバック: unknown
  const fallback = db.exec(
    "SELECT media_type_id FROM media_types WHERE code = 'unknown';",
    { returnValue: 'resultRows' },
  ) as number[][]
  return fallback[0][0]
}

function syncPostMedia(
  db: DbExec,
  postId: number,
  mediaAttachments: Entity.Attachment[],
  isSensitive: boolean,
): void {
  db.exec('DELETE FROM post_media WHERE post_id = ?;', { bind: [postId] })
  for (let i = 0; i < mediaAttachments.length; i++) {
    const media = mediaAttachments[i]
    const mediaTypeId = resolveMediaTypeId(db, media.type)
    db.exec(
      `INSERT INTO post_media (
        post_id, media_type_id, remote_media_id, url, preview_url,
        description, blurhash, sort_order, is_sensitive
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      {
        bind: [
          postId,
          mediaTypeId,
          media.id,
          media.url,
          media.preview_url ?? null,
          media.description ?? null,
          media.blurhash ?? null,
          i,
          isSensitive ? 1 : 0,
        ],
      },
    )
  }
}

function syncPostStats(
  db: DbExec,
  postId: number,
  status: Entity.Status,
): void {
  db.exec(
    `INSERT INTO post_stats (
      post_id, replies_count, reblogs_count, favourites_count, fetched_at
    ) VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(post_id) DO UPDATE SET
      replies_count    = excluded.replies_count,
      reblogs_count    = excluded.reblogs_count,
      favourites_count = excluded.favourites_count,
      fetched_at       = excluded.fetched_at;`,
    {
      bind: [
        postId,
        status.replies_count,
        status.reblogs_count,
        status.favourites_count,
      ],
    },
  )
}

// ================================================================
// 公開ハンドラ
// ================================================================

export function handleUpsertStatus(
  db: DbExec,
  statusJson: string,
  backendUrl: string,
  timelineType: string,
  tag?: string,
): HandlerResult {
  const status = JSON.parse(statusJson) as Entity.Status
  const normalizedUri = status.uri?.trim() || ''
  const now = Date.now()
  const created_at_ms = new Date(status.created_at).getTime()
  const cols = extractStatusColumns(status)

  db.exec('BEGIN;')
  try {
    const serverId = ensureServer(db, backendUrl)
    const visibilityId = resolveVisibilityId(db, cols.visibility)
    const profileId = ensureProfile(db, status.account)

    let postId: number | undefined
    let existingIsOriginal = false

    // URI で既存投稿を検索
    if (normalizedUri) {
      const existingRows = db.exec(
        'SELECT post_id, is_reblog FROM posts WHERE object_uri = ?;',
        { bind: [normalizedUri], returnValue: 'resultRows' },
      ) as number[][]
      if (existingRows.length > 0) {
        if (cols.is_reblog === 1 && existingRows[0][1] === 0) {
          existingIsOriginal = true
        } else {
          postId = existingRows[0][0]
        }
      }
    }

    // URI で見つからない場合、posts_backends で検索
    if (postId === undefined && !existingIsOriginal) {
      postId = resolvePostIdInternal(db, backendUrl, status.id) ?? undefined
    }

    if (postId !== undefined) {
      db.exec(
        `UPDATE posts SET
          stored_at          = ?,
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
          edited_at          = ?,
          author_profile_id  = ?
        WHERE post_id = ?;`,
        {
          bind: [
            now,
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
            profileId,
            postId,
          ],
        },
      )
    } else {
      const insertUri = existingIsOriginal ? '' : cols.uri
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
            insertUri,
            serverId,
            created_at_ms,
            now,
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

    db.exec(
      `INSERT OR IGNORE INTO posts_backends (post_id, backendUrl, local_id, server_id)
       VALUES (?, ?, ?, ?);`,
      { bind: [postId, backendUrl, status.id, serverId] },
    )

    // timeline_items に登録（timelines が未作成なら自動作成）
    const timelineId = ensureTimeline(db, serverId, timelineType, tag)
    const postItemKindId = resolvePostItemKindId(db)
    db.exec(
      `INSERT OR IGNORE INTO timeline_items (timeline_id, timeline_item_kind_id, post_id, sort_key, inserted_at)
       VALUES (?, ?, ?, ?, ?);`,
      { bind: [timelineId, postItemKindId, postId, created_at_ms, now] },
    )

    for (const t of status.tags) {
      db.exec(
        `INSERT OR IGNORE INTO posts_belonging_tags (post_id, tag)
         VALUES (?, ?);`,
        { bind: [postId, t.name] },
      )
    }

    if (tag) {
      db.exec(
        `INSERT OR IGNORE INTO posts_belonging_tags (post_id, tag)
         VALUES (?, ?);`,
        { bind: [postId, tag] },
      )
    }

    upsertMentionsInternal(db, postId, status.mentions)
    syncPostMedia(db, postId, status.media_attachments, status.sensitive)
    syncPostStats(db, postId, status)

    if (cols.is_reblog === 1 && cols.reblog_of_uri) {
      db.exec(
        `INSERT OR REPLACE INTO posts_reblogs (post_id, original_uri, reblogger_acct, reblogged_at_ms)
         VALUES (?, ?, ?, ?);`,
        {
          bind: [
            postId,
            cols.reblog_of_uri,
            status.account.acct,
            created_at_ms,
          ],
        },
      )
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['posts'] }
}

export function handleBulkUpsertStatuses(
  db: DbExec,
  statusesJson: string[],
  backendUrl: string,
  timelineType: string,
  tag?: string,
): HandlerResult {
  if (statusesJson.length === 0) return { changedTables: [] }

  const now = Date.now()
  const uriCache = new Map<string, number>()

  db.exec('BEGIN;')
  try {
    const serverId = ensureServer(db, backendUrl)

    for (const sJson of statusesJson) {
      const status = JSON.parse(sJson) as Entity.Status
      const normalizedUri = status.uri?.trim() || ''
      const created_at_ms = new Date(status.created_at).getTime()
      const cols = extractStatusColumns(status)
      const visibilityId = resolveVisibilityId(db, cols.visibility)
      const profileId = ensureProfile(db, status.account)

      let postId: number | undefined = normalizedUri
        ? uriCache.get(normalizedUri)
        : undefined

      // リブログが元投稿を上書きしないようにする
      let existingIsOriginal = false

      if (postId === undefined && normalizedUri) {
        const existingRows = db.exec(
          'SELECT post_id, is_reblog FROM posts WHERE object_uri = ?;',
          { bind: [normalizedUri], returnValue: 'resultRows' },
        ) as number[][]
        if (existingRows.length > 0) {
          if (cols.is_reblog === 1 && existingRows[0][1] === 0) {
            existingIsOriginal = true
          } else {
            postId = existingRows[0][0]
          }
        }
      }

      // URI で見つからない場合、posts_backends で検索
      if (postId === undefined && !existingIsOriginal) {
        postId = resolvePostIdInternal(db, backendUrl, status.id) ?? undefined
      }

      if (postId !== undefined) {
        db.exec(
          `UPDATE posts SET
            stored_at          = ?,
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
            edited_at          = ?,
            author_profile_id  = ?
          WHERE post_id = ?;`,
          {
            bind: [
              now,
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
              profileId,
              postId,
            ],
          },
        )
      } else {
        const insertUri = existingIsOriginal ? '' : cols.uri
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
              insertUri,
              serverId,
              created_at_ms,
              now,
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

      if (normalizedUri) {
        uriCache.set(normalizedUri, postId)
      }

      db.exec(
        `INSERT OR IGNORE INTO posts_backends (post_id, backendUrl, local_id, server_id)
         VALUES (?, ?, ?, ?);`,
        { bind: [postId, backendUrl, status.id, serverId] },
      )

      // timeline_items に登録（timelines が未作成なら自動作成）
      const timelineId = ensureTimeline(db, serverId, timelineType, tag)
      const postItemKindId = resolvePostItemKindId(db)
      db.exec(
        `INSERT OR IGNORE INTO timeline_items (timeline_id, timeline_item_kind_id, post_id, sort_key, inserted_at)
         VALUES (?, ?, ?, ?, ?);`,
        { bind: [timelineId, postItemKindId, postId, created_at_ms, now] },
      )

      for (const t of status.tags) {
        db.exec(
          `INSERT OR IGNORE INTO posts_belonging_tags (post_id, tag)
           VALUES (?, ?);`,
          { bind: [postId, t.name] },
        )
      }

      if (tag) {
        db.exec(
          `INSERT OR IGNORE INTO posts_belonging_tags (post_id, tag)
           VALUES (?, ?);`,
          { bind: [postId, tag] },
        )
      }

      upsertMentionsInternal(db, postId, status.mentions)
      syncPostMedia(db, postId, status.media_attachments, status.sensitive)
      syncPostStats(db, postId, status)

      // リブログ関係を posts_reblogs に記録（元投稿の URI が存在する場合のみ）
      if (cols.is_reblog === 1 && cols.reblog_of_uri) {
        db.exec(
          `INSERT OR REPLACE INTO posts_reblogs (post_id, original_uri, reblogger_acct, reblogged_at_ms)
           VALUES (?, ?, ?, ?);`,
          {
            bind: [
              postId,
              cols.reblog_of_uri,
              status.account.acct,
              created_at_ms,
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

  return { changedTables: ['posts'] }
}

export function handleRemoveFromTimeline(
  db: DbExec,
  backendUrl: string,
  statusId: string,
  timelineType: string,
  tag?: string,
): HandlerResult {
  const postId = resolvePostIdInternal(db, backendUrl, statusId)
  if (postId === null) return { changedTables: [] }

  const serverId = ensureServer(db, backendUrl)

  db.exec('BEGIN;')
  try {
    // 該当タイムラインから timeline_items を削除
    const timelineRows = db.exec(
      `SELECT t.timeline_id FROM timelines t
       INNER JOIN channel_kinds ck ON ck.channel_kind_id = t.channel_kind_id
       WHERE t.server_id = ? AND ck.code = ? AND COALESCE(t.tag, '') = ?;`,
      { bind: [serverId, timelineType, tag ?? ''], returnValue: 'resultRows' },
    ) as number[][]

    for (const [timelineId] of timelineRows) {
      db.exec(
        'DELETE FROM timeline_items WHERE timeline_id = ? AND post_id = ?;',
        { bind: [timelineId, postId] },
      )
    }

    if (timelineType === 'tag' && tag) {
      db.exec(
        'DELETE FROM posts_belonging_tags WHERE post_id = ? AND tag = ?;',
        { bind: [postId, tag] },
      )
    }

    // どのタイムラインにも属さなくなった投稿を削除
    const remaining = (
      db.exec('SELECT COUNT(*) FROM timeline_items WHERE post_id = ?;', {
        bind: [postId],
        returnValue: 'resultRows',
      }) as number[][]
    )[0][0]

    if (remaining === 0) {
      db.exec('DELETE FROM posts WHERE post_id = ?;', {
        bind: [postId],
      })
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['posts'] }
}

export function handleDeleteEvent(
  db: DbExec,
  backendUrl: string,
  statusId: string,
  sourceTimelineType: string,
  tag?: string,
): HandlerResult {
  const postId = resolvePostIdInternal(db, backendUrl, statusId)
  if (postId === null) return { changedTables: [] }

  const serverId = ensureServer(db, backendUrl)

  db.exec('BEGIN;')
  try {
    db.exec(
      'DELETE FROM posts_backends WHERE backendUrl = ? AND local_id = ?;',
      { bind: [backendUrl, statusId] },
    )

    const remainingBackends = (
      db.exec('SELECT COUNT(*) FROM posts_backends WHERE post_id = ?;', {
        bind: [postId],
        returnValue: 'resultRows',
      }) as number[][]
    )[0][0]

    if (remainingBackends === 0) {
      db.exec('DELETE FROM posts WHERE post_id = ?;', {
        bind: [postId],
      })
    } else {
      // 該当タイムラインから timeline_items を削除
      const timelineRows = db.exec(
        `SELECT t.timeline_id FROM timelines t
         INNER JOIN channel_kinds ck ON ck.channel_kind_id = t.channel_kind_id
         WHERE t.server_id = ? AND ck.code = ? AND COALESCE(t.tag, '') = ?;`,
        {
          bind: [serverId, sourceTimelineType, tag ?? ''],
          returnValue: 'resultRows',
        },
      ) as number[][]

      for (const [timelineId] of timelineRows) {
        db.exec(
          'DELETE FROM timeline_items WHERE timeline_id = ? AND post_id = ?;',
          { bind: [timelineId, postId] },
        )
      }

      if (sourceTimelineType === 'tag' && tag) {
        db.exec(
          'DELETE FROM posts_belonging_tags WHERE post_id = ? AND tag = ?;',
          { bind: [postId, tag] },
        )
      }

      // どのタイムラインにも属さなくなった投稿を削除
      const remainingTimelines = (
        db.exec('SELECT COUNT(*) FROM timeline_items WHERE post_id = ?;', {
          bind: [postId],
          returnValue: 'resultRows',
        }) as number[][]
      )[0][0]

      if (remainingTimelines === 0) {
        db.exec('DELETE FROM posts WHERE post_id = ?;', {
          bind: [postId],
        })
      }
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['posts'] }
}

export function handleUpdateStatusAction(
  db: DbExec,
  backendUrl: string,
  statusId: string,
  action: 'reblogged' | 'favourited' | 'bookmarked',
  value: boolean,
): HandlerResult {
  const postId = resolvePostIdInternal(db, backendUrl, statusId)
  if (postId === null) return { changedTables: [] }

  db.exec('BEGIN;')
  try {
    const localAccountId = resolveLocalAccountId(db, backendUrl)
    if (localAccountId !== null) {
      const engagementCode = ACTION_TO_ENGAGEMENT[action]
      if (engagementCode) {
        // 自分自身のエンゲージメントをトグル
        toggleEngagement(db, localAccountId, postId, engagementCode, value)

        // reblog チェーン: object_uri と reblog_of_uri から関連投稿を更新
        const postInfo = db.exec(
          'SELECT object_uri, reblog_of_uri FROM posts WHERE post_id = ?;',
          { bind: [postId], returnValue: 'resultRows' },
        ) as (string | null)[][]

        if (postInfo.length > 0) {
          const objectUri = postInfo[0][0] as string
          const reblogOfUri = postInfo[0][1] as string | null

          // reblog 元の投稿もトグル
          if (reblogOfUri) {
            const originalRows = db.exec(
              'SELECT post_id FROM posts WHERE object_uri = ?;',
              { bind: [reblogOfUri], returnValue: 'resultRows' },
            ) as number[][]
            if (originalRows.length > 0) {
              toggleEngagement(
                db,
                localAccountId,
                originalRows[0][0],
                engagementCode,
                value,
              )
            }
          }

          // この投稿を reblog として持つ他の投稿もトグル
          if (objectUri) {
            const reblogRows = db.exec(
              `SELECT pr.post_id FROM posts_reblogs pr WHERE pr.original_uri = ?;`,
              { bind: [objectUri], returnValue: 'resultRows' },
            ) as number[][]
            for (const row of reblogRows) {
              toggleEngagement(
                db,
                localAccountId,
                row[0],
                engagementCode,
                value,
              )
            }
          }
        }
      }
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['posts'] }
}

export function handleUpdateStatus(
  db: DbExec,
  statusJson: string,
  backendUrl: string,
): HandlerResult {
  const status = JSON.parse(statusJson) as Entity.Status
  const created_at_ms = new Date(status.created_at).getTime()
  const now = Date.now()
  const cols = extractStatusColumns(status)

  const postId = resolvePostIdInternal(db, backendUrl, status.id)
  if (postId === null) return { changedTables: [] }

  const existing = db.exec('SELECT post_id FROM posts WHERE post_id = ?;', {
    bind: [postId],
    returnValue: 'resultRows',
  }) as number[][]

  if (existing.length === 0) return { changedTables: [] }

  db.exec('BEGIN;')
  try {
    const visibilityId = resolveVisibilityId(db, cols.visibility)
    const profileId = ensureProfile(db, status.account)

    db.exec(
      `UPDATE posts SET
         created_at_ms      = ?,
         stored_at          = ?,
         object_uri         = ?,
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
         edited_at          = ?,
         author_profile_id  = ?
       WHERE post_id = ?;`,
      {
        bind: [
          created_at_ms,
          now,
          cols.uri,
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
          profileId,
          postId,
        ],
      },
    )

    db.exec('DELETE FROM posts_belonging_tags WHERE post_id = ?;', {
      bind: [postId],
    })
    for (const t of status.tags) {
      db.exec(
        `INSERT OR IGNORE INTO posts_belonging_tags (post_id, tag)
         VALUES (?, ?);`,
        { bind: [postId, t.name] },
      )
    }

    upsertMentionsInternal(db, postId, status.mentions)
    syncPostMedia(db, postId, status.media_attachments, status.sensitive)
    syncPostStats(db, postId, status)

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['posts'] }
}
