/**
 * Worker 側: Status 関連のトランザクション処理
 *
 * 現行 statusStore.ts のビジネスロジックを Worker 内で実行する純粋関数群。
 * 生の Database オブジェクトを引数に取り、フォールバックモードからも直接呼べる。
 */

import type { Entity } from 'megalodon'
import type { TableName } from '../protocol'
import { extractStatusColumns } from '../shared'

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
  const rows = db.exec(
    'SELECT post_id FROM posts_backends WHERE backendUrl = ? AND local_id = ?;',
    { bind: [backendUrl, localId], returnValue: 'resultRows' },
  ) as number[][]
  return rows.length > 0 ? rows[0][0] : null
}

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
      // 既存投稿を更新
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
            now,
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
            JSON.stringify(status),
            postId,
          ],
        },
      )
    } else {
      // 新規投稿を挿入（post_id は自動生成）
      // リブログが元投稿の URI と衝突する場合は空文字にして UNIQUE 制約違反を回避
      const insertUri = existingIsOriginal ? '' : cols.uri
      db.exec(
        `INSERT INTO posts (
          origin_backend_url, created_at_ms, stored_at,
          object_uri,
          account_acct, account_id, visibility, language,
          has_media, media_count, is_reblog, reblog_of_id, reblog_of_uri,
          is_sensitive, has_spoiler, in_reply_to_id,
          favourites_count, reblogs_count, replies_count,
          json
        ) VALUES (?,?,?, ?, ?,?,?,?, ?,?,?,?,?, ?,?,?, ?,?,?, ?);`,
        {
          bind: [
            backendUrl,
            created_at_ms,
            now,
            insertUri,
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
            JSON.stringify(status),
          ],
        },
      )
      postId = getLastInsertRowId(db)
    }

    db.exec(
      `INSERT OR IGNORE INTO posts_backends (post_id, backendUrl, local_id)
       VALUES (?, ?, ?);`,
      { bind: [postId, backendUrl, status.id] },
    )

    db.exec(
      `INSERT OR IGNORE INTO posts_timeline_types (post_id, timelineType)
       VALUES (?, ?);`,
      { bind: [postId, timelineType] },
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

    // リブログ関係を posts_reblogs に記録（元投稿の URI が存在する場合のみ）
    if (cols.is_reblog === 1 && cols.reblog_of_uri) {
      db.exec(
        `INSERT OR REPLACE INTO posts_reblogs (post_id, original_uri, reblogger_acct, reblogged_at_ms)
         VALUES (?, ?, ?, ?);`,
        {
          bind: [postId, cols.reblog_of_uri, cols.account_acct, created_at_ms],
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
    for (const sJson of statusesJson) {
      const status = JSON.parse(sJson) as Entity.Status
      const normalizedUri = status.uri?.trim() || ''
      const created_at_ms = new Date(status.created_at).getTime()
      const cols = extractStatusColumns(status)

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
              now,
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
              JSON.stringify(status),
              postId,
            ],
          },
        )
      } else {
        // リブログが元投稿の URI と衝突する場合は空文字にして UNIQUE 制約違反を回避
        const insertUri = existingIsOriginal ? '' : cols.uri
        db.exec(
          `INSERT INTO posts (
            origin_backend_url, created_at_ms, stored_at,
            object_uri,
            account_acct, account_id, visibility, language,
            has_media, media_count, is_reblog, reblog_of_id, reblog_of_uri,
            is_sensitive, has_spoiler, in_reply_to_id,
            favourites_count, reblogs_count, replies_count,
            json
          ) VALUES (?,?,?, ?, ?,?,?,?, ?,?,?,?,?, ?,?,?, ?,?,?, ?);`,
          {
            bind: [
              backendUrl,
              created_at_ms,
              now,
              insertUri,
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
              JSON.stringify(status),
            ],
          },
        )
        postId = getLastInsertRowId(db)
      }

      if (normalizedUri) {
        uriCache.set(normalizedUri, postId)
      }

      db.exec(
        `INSERT OR IGNORE INTO posts_backends (post_id, backendUrl, local_id)
         VALUES (?, ?, ?);`,
        { bind: [postId, backendUrl, status.id] },
      )

      db.exec(
        `INSERT OR IGNORE INTO posts_timeline_types (post_id, timelineType)
         VALUES (?, ?);`,
        { bind: [postId, timelineType] },
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

      // リブログ関係を posts_reblogs に記録（元投稿の URI が存在する場合のみ）
      if (cols.is_reblog === 1 && cols.reblog_of_uri) {
        db.exec(
          `INSERT OR REPLACE INTO posts_reblogs (post_id, original_uri, reblogger_acct, reblogged_at_ms)
           VALUES (?, ?, ?, ?);`,
          {
            bind: [
              postId,
              cols.reblog_of_uri,
              cols.account_acct,
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

  db.exec('BEGIN;')
  try {
    db.exec(
      'DELETE FROM posts_timeline_types WHERE post_id = ? AND timelineType = ?;',
      { bind: [postId, timelineType] },
    )

    if (timelineType === 'tag' && tag) {
      db.exec(
        'DELETE FROM posts_belonging_tags WHERE post_id = ? AND tag = ?;',
        { bind: [postId, tag] },
      )

      const remainingTags = (
        db.exec(
          'SELECT COUNT(*) FROM posts_belonging_tags WHERE post_id = ?;',
          { bind: [postId], returnValue: 'resultRows' },
        ) as number[][]
      )[0][0]

      if (remainingTags > 0) {
        db.exec(
          `INSERT OR IGNORE INTO posts_timeline_types (post_id, timelineType)
           VALUES (?, 'tag');`,
          { bind: [postId] },
        )
      }
    }

    const remaining = (
      db.exec('SELECT COUNT(*) FROM posts_timeline_types WHERE post_id = ?;', {
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
      db.exec(
        'DELETE FROM posts_timeline_types WHERE post_id = ? AND timelineType = ?;',
        { bind: [postId, sourceTimelineType] },
      )

      if (sourceTimelineType === 'tag' && tag) {
        db.exec(
          'DELETE FROM posts_belonging_tags WHERE post_id = ? AND tag = ?;',
          { bind: [postId, tag] },
        )

        // 残りのタグが存在する場合は 'tag' タイムラインタイプを再挿入
        const remainingTags = (
          db.exec(
            'SELECT COUNT(*) FROM posts_belonging_tags WHERE post_id = ?;',
            { bind: [postId], returnValue: 'resultRows' },
          ) as number[][]
        )[0][0]

        if (remainingTags > 0) {
          db.exec(
            `INSERT OR IGNORE INTO posts_timeline_types (post_id, timelineType) VALUES (?, 'tag');`,
            { bind: [postId] },
          )
        }
      }

      const remainingTimelines = (
        db.exec(
          'SELECT COUNT(*) FROM posts_timeline_types WHERE post_id = ?;',
          { bind: [postId], returnValue: 'resultRows' },
        ) as number[][]
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
    const rows = db.exec(
      'SELECT json, object_uri FROM posts WHERE post_id = ?;',
      { bind: [postId], returnValue: 'resultRows' },
    ) as string[][]

    if (rows.length > 0) {
      const status = JSON.parse(rows[0][0]) as Entity.Status
      const statusUri = rows[0][1] as string
      ;(status as Record<string, unknown>)[action] = value

      db.exec('UPDATE posts SET json = ? WHERE post_id = ?;', {
        bind: [JSON.stringify(status), postId],
      })

      // reblog 元の更新
      if (status.reblog) {
        const reblogUri = status.reblog.uri
        if (reblogUri) {
          const reblogRows = db.exec(
            'SELECT post_id, json FROM posts WHERE object_uri = ?;',
            { bind: [reblogUri], returnValue: 'resultRows' },
          ) as (string | number)[][]

          if (reblogRows.length > 0) {
            const reblogPostId = reblogRows[0][0] as number
            const reblogStatus = JSON.parse(
              reblogRows[0][1] as string,
            ) as Entity.Status
            ;(reblogStatus as Record<string, unknown>)[action] = value
            db.exec('UPDATE posts SET json = ? WHERE post_id = ?;', {
              bind: [JSON.stringify(reblogStatus), reblogPostId],
            })
          }
        }
      }

      // この Status を reblog として持つ他の Status も更新（posts_reblogs 経由）
      if (statusUri) {
        const relatedRows = db.exec(
          `SELECT p.post_id, p.json FROM posts p
           INNER JOIN posts_reblogs pr ON p.post_id = pr.post_id
           WHERE pr.original_uri = ?;`,
          { bind: [statusUri], returnValue: 'resultRows' },
        ) as (string | number)[][]

        for (const row of relatedRows) {
          const json = JSON.parse(row[1] as string) as Entity.Status
          if (json.reblog) {
            ;(json.reblog as Record<string, unknown>)[action] = value
            db.exec('UPDATE posts SET json = ? WHERE post_id = ?;', {
              bind: [JSON.stringify(json), row[0] as number],
            })
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
    db.exec(
      `UPDATE posts SET
         created_at_ms    = ?,
         stored_at        = ?,
         object_uri       = ?,
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
          created_at_ms,
          now,
          cols.uri,
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
          JSON.stringify(status),
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

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['posts'] }
}
