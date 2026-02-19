/**
 * Worker 側: Status 関連のトランザクション処理
 *
 * 現行 statusStore.ts のビジネスロジックを Worker 内で実行する純粋関数群。
 * 生の Database オブジェクトを引数に取り、フォールバックモードからも直接呼べる。
 */

import type { Entity } from 'megalodon'
import type { TableName } from '../protocol'
import { createCompositeKey, extractStatusColumns } from '../shared'

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

function resolveCompositeKeyInternal(
  db: DbExec,
  backendUrl: string,
  localId: string,
): string | null {
  const rows = db.exec(
    'SELECT compositeKey FROM statuses_backends WHERE backendUrl = ? AND local_id = ?;',
    { bind: [backendUrl, localId], returnValue: 'resultRows' },
  ) as string[][]
  return rows.length > 0 ? rows[0][0] : null
}

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
    let compositeKey: string
    const existingRows = normalizedUri
      ? (db.exec('SELECT compositeKey FROM statuses WHERE uri = ?;', {
          bind: [normalizedUri],
          returnValue: 'resultRows',
        }) as string[][])
      : []

    if (existingRows.length > 0) {
      compositeKey = existingRows[0][0]
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
            compositeKey,
          ],
        },
      )
    } else {
      compositeKey = createCompositeKey(backendUrl, status.id)
      db.exec(
        `INSERT INTO statuses (
          compositeKey, backendUrl, created_at_ms, storedAt,
          uri,
          account_acct, account_id, visibility, language,
          has_media, media_count, is_reblog, reblog_of_id, reblog_of_uri,
          is_sensitive, has_spoiler, in_reply_to_id,
          favourites_count, reblogs_count, replies_count,
          json
        ) VALUES (?,?,?,?, ?, ?,?,?,?, ?,?,?,?,?, ?,?,?, ?,?,?, ?)
        ON CONFLICT(compositeKey) DO UPDATE SET
          storedAt         = excluded.storedAt,
          account_acct     = excluded.account_acct,
          account_id       = excluded.account_id,
          visibility       = excluded.visibility,
          language         = excluded.language,
          has_media        = excluded.has_media,
          media_count      = excluded.media_count,
          is_reblog        = excluded.is_reblog,
          reblog_of_id     = excluded.reblog_of_id,
          reblog_of_uri    = excluded.reblog_of_uri,
          is_sensitive     = excluded.is_sensitive,
          has_spoiler      = excluded.has_spoiler,
          in_reply_to_id   = excluded.in_reply_to_id,
          favourites_count = excluded.favourites_count,
          reblogs_count    = excluded.reblogs_count,
          replies_count    = excluded.replies_count,
          json             = excluded.json;`,
        {
          bind: [
            compositeKey,
            backendUrl,
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
          ],
        },
      )
    }

    db.exec(
      `INSERT OR IGNORE INTO statuses_backends (compositeKey, backendUrl, local_id)
       VALUES (?, ?, ?);`,
      { bind: [compositeKey, backendUrl, status.id] },
    )

    db.exec(
      `INSERT OR IGNORE INTO statuses_timeline_types (compositeKey, timelineType)
       VALUES (?, ?);`,
      { bind: [compositeKey, timelineType] },
    )

    for (const t of status.tags) {
      db.exec(
        `INSERT OR IGNORE INTO statuses_belonging_tags (compositeKey, tag)
         VALUES (?, ?);`,
        { bind: [compositeKey, t.name] },
      )
    }

    if (tag) {
      db.exec(
        `INSERT OR IGNORE INTO statuses_belonging_tags (compositeKey, tag)
         VALUES (?, ?);`,
        { bind: [compositeKey, tag] },
      )
    }

    upsertMentionsInternal(db, compositeKey, status.mentions)

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['statuses'] }
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
  const uriCache = new Map<string, string>()

  db.exec('BEGIN;')
  try {
    for (const sJson of statusesJson) {
      const status = JSON.parse(sJson) as Entity.Status
      const normalizedUri = status.uri?.trim() || ''
      const created_at_ms = new Date(status.created_at).getTime()
      const cols = extractStatusColumns(status)

      let compositeKey: string | undefined = normalizedUri
        ? uriCache.get(normalizedUri)
        : undefined

      if (compositeKey === undefined && normalizedUri) {
        const existingRows = db.exec(
          'SELECT compositeKey FROM statuses WHERE uri = ?;',
          { bind: [normalizedUri], returnValue: 'resultRows' },
        ) as string[][]
        compositeKey = existingRows.length > 0 ? existingRows[0][0] : undefined
      }

      if (compositeKey !== undefined) {
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
              compositeKey,
            ],
          },
        )
      } else {
        compositeKey = createCompositeKey(backendUrl, status.id)
        db.exec(
          `INSERT INTO statuses (
            compositeKey, backendUrl, created_at_ms, storedAt,
            uri,
            account_acct, account_id, visibility, language,
            has_media, media_count, is_reblog, reblog_of_id, reblog_of_uri,
            is_sensitive, has_spoiler, in_reply_to_id,
            favourites_count, reblogs_count, replies_count,
            json
          ) VALUES (?,?,?,?, ?, ?,?,?,?, ?,?,?,?,?, ?,?,?, ?,?,?, ?)
          ON CONFLICT(compositeKey) DO UPDATE SET
            storedAt         = excluded.storedAt,
            account_acct     = excluded.account_acct,
            account_id       = excluded.account_id,
            visibility       = excluded.visibility,
            language         = excluded.language,
            has_media        = excluded.has_media,
            media_count      = excluded.media_count,
            is_reblog        = excluded.is_reblog,
            reblog_of_id     = excluded.reblog_of_id,
            reblog_of_uri    = excluded.reblog_of_uri,
            is_sensitive     = excluded.is_sensitive,
            has_spoiler      = excluded.has_spoiler,
            in_reply_to_id   = excluded.in_reply_to_id,
            favourites_count = excluded.favourites_count,
            reblogs_count    = excluded.reblogs_count,
            replies_count    = excluded.replies_count,
            json             = excluded.json;`,
          {
            bind: [
              compositeKey,
              backendUrl,
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
            ],
          },
        )
      }

      if (normalizedUri) {
        uriCache.set(normalizedUri, compositeKey)
      }

      db.exec(
        `INSERT OR IGNORE INTO statuses_backends (compositeKey, backendUrl, local_id)
         VALUES (?, ?, ?);`,
        { bind: [compositeKey, backendUrl, status.id] },
      )

      db.exec(
        `INSERT OR IGNORE INTO statuses_timeline_types (compositeKey, timelineType)
         VALUES (?, ?);`,
        { bind: [compositeKey, timelineType] },
      )

      for (const t of status.tags) {
        db.exec(
          `INSERT OR IGNORE INTO statuses_belonging_tags (compositeKey, tag)
           VALUES (?, ?);`,
          { bind: [compositeKey, t.name] },
        )
      }

      if (tag) {
        db.exec(
          `INSERT OR IGNORE INTO statuses_belonging_tags (compositeKey, tag)
           VALUES (?, ?);`,
          { bind: [compositeKey, tag] },
        )
      }

      upsertMentionsInternal(db, compositeKey, status.mentions)
    }
    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['statuses'] }
}

export function handleRemoveFromTimeline(
  db: DbExec,
  backendUrl: string,
  statusId: string,
  timelineType: string,
  tag?: string,
): HandlerResult {
  const compositeKey =
    resolveCompositeKeyInternal(db, backendUrl, statusId) ??
    createCompositeKey(backendUrl, statusId)

  db.exec('BEGIN;')
  try {
    db.exec(
      'DELETE FROM statuses_timeline_types WHERE compositeKey = ? AND timelineType = ?;',
      { bind: [compositeKey, timelineType] },
    )

    if (timelineType === 'tag' && tag) {
      db.exec(
        'DELETE FROM statuses_belonging_tags WHERE compositeKey = ? AND tag = ?;',
        { bind: [compositeKey, tag] },
      )

      const remainingTags = (
        db.exec(
          'SELECT COUNT(*) FROM statuses_belonging_tags WHERE compositeKey = ?;',
          { bind: [compositeKey], returnValue: 'resultRows' },
        ) as number[][]
      )[0][0]

      if (remainingTags > 0) {
        db.exec(
          `INSERT OR IGNORE INTO statuses_timeline_types (compositeKey, timelineType)
           VALUES (?, 'tag');`,
          { bind: [compositeKey] },
        )
      }
    }

    const remaining = (
      db.exec(
        'SELECT COUNT(*) FROM statuses_timeline_types WHERE compositeKey = ?;',
        { bind: [compositeKey], returnValue: 'resultRows' },
      ) as number[][]
    )[0][0]

    if (remaining === 0) {
      db.exec('DELETE FROM statuses WHERE compositeKey = ?;', {
        bind: [compositeKey],
      })
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['statuses'] }
}

export function handleDeleteEvent(
  db: DbExec,
  backendUrl: string,
  statusId: string,
  sourceTimelineType: string,
  tag?: string,
): HandlerResult {
  const compositeKey = resolveCompositeKeyInternal(db, backendUrl, statusId)
  if (!compositeKey) return { changedTables: [] }

  db.exec('BEGIN;')
  try {
    db.exec(
      'DELETE FROM statuses_backends WHERE backendUrl = ? AND local_id = ?;',
      { bind: [backendUrl, statusId] },
    )

    const remainingBackends = (
      db.exec(
        'SELECT COUNT(*) FROM statuses_backends WHERE compositeKey = ?;',
        { bind: [compositeKey], returnValue: 'resultRows' },
      ) as number[][]
    )[0][0]

    if (remainingBackends === 0) {
      db.exec('DELETE FROM statuses WHERE compositeKey = ?;', {
        bind: [compositeKey],
      })
    } else {
      db.exec(
        'DELETE FROM statuses_timeline_types WHERE compositeKey = ? AND timelineType = ?;',
        { bind: [compositeKey, sourceTimelineType] },
      )

      if (sourceTimelineType === 'tag' && tag) {
        db.exec(
          'DELETE FROM statuses_belonging_tags WHERE compositeKey = ? AND tag = ?;',
          { bind: [compositeKey, tag] },
        )

        // 残りのタグが存在する場合は 'tag' タイムラインタイプを再挿入
        const remainingTags = (
          db.exec(
            'SELECT COUNT(*) FROM statuses_belonging_tags WHERE compositeKey = ?;',
            { bind: [compositeKey], returnValue: 'resultRows' },
          ) as number[][]
        )[0][0]

        if (remainingTags > 0) {
          db.exec(
            `INSERT OR IGNORE INTO statuses_timeline_types (compositeKey, timelineType) VALUES (?, 'tag');`,
            { bind: [compositeKey] },
          )
        }
      }

      const remainingTimelines = (
        db.exec(
          'SELECT COUNT(*) FROM statuses_timeline_types WHERE compositeKey = ?;',
          { bind: [compositeKey], returnValue: 'resultRows' },
        ) as number[][]
      )[0][0]

      if (remainingTimelines === 0) {
        db.exec('DELETE FROM statuses WHERE compositeKey = ?;', {
          bind: [compositeKey],
        })
      }
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['statuses'] }
}

export function handleUpdateStatusAction(
  db: DbExec,
  backendUrl: string,
  statusId: string,
  action: 'reblogged' | 'favourited' | 'bookmarked',
  value: boolean,
): HandlerResult {
  const compositeKey = resolveCompositeKeyInternal(db, backendUrl, statusId)
  if (!compositeKey) return { changedTables: [] }

  db.exec('BEGIN;')
  try {
    const rows = db.exec(
      'SELECT json, uri FROM statuses WHERE compositeKey = ?;',
      { bind: [compositeKey], returnValue: 'resultRows' },
    ) as string[][]

    if (rows.length > 0) {
      const status = JSON.parse(rows[0][0]) as Entity.Status
      const statusUri = rows[0][1] as string
      ;(status as Record<string, unknown>)[action] = value

      db.exec('UPDATE statuses SET json = ? WHERE compositeKey = ?;', {
        bind: [JSON.stringify(status), compositeKey],
      })

      // reblog 元の更新
      if (status.reblog) {
        const reblogUri = status.reblog.uri
        if (reblogUri) {
          const reblogRows = db.exec(
            'SELECT compositeKey, json FROM statuses WHERE uri = ?;',
            { bind: [reblogUri], returnValue: 'resultRows' },
          ) as string[][]

          if (reblogRows.length > 0) {
            const reblogKey = reblogRows[0][0]
            const reblogStatus = JSON.parse(reblogRows[0][1]) as Entity.Status
            ;(reblogStatus as Record<string, unknown>)[action] = value
            db.exec('UPDATE statuses SET json = ? WHERE compositeKey = ?;', {
              bind: [JSON.stringify(reblogStatus), reblogKey],
            })
          }
        }
      }

      // この Status を reblog として持つ他の Status も更新
      if (statusUri) {
        const relatedRows = db.exec(
          'SELECT compositeKey, json FROM statuses WHERE reblog_of_uri = ?;',
          { bind: [statusUri], returnValue: 'resultRows' },
        ) as (string | number)[][]

        for (const row of relatedRows) {
          const json = JSON.parse(row[1] as string) as Entity.Status
          if (json.reblog) {
            ;(json.reblog as Record<string, unknown>)[action] = value
            db.exec('UPDATE statuses SET json = ? WHERE compositeKey = ?;', {
              bind: [JSON.stringify(json), row[0] as string],
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

  return { changedTables: ['statuses'] }
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

  const compositeKey =
    resolveCompositeKeyInternal(db, backendUrl, status.id) ??
    createCompositeKey(backendUrl, status.id)

  const existing = db.exec(
    'SELECT compositeKey FROM statuses WHERE compositeKey = ?;',
    { bind: [compositeKey], returnValue: 'resultRows' },
  ) as string[][]

  if (existing.length === 0) return { changedTables: [] }

  db.exec('BEGIN;')
  try {
    db.exec(
      `UPDATE statuses SET
         created_at_ms    = ?,
         storedAt         = ?,
         uri              = ?,
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
          compositeKey,
        ],
      },
    )

    db.exec('DELETE FROM statuses_belonging_tags WHERE compositeKey = ?;', {
      bind: [compositeKey],
    })
    for (const t of status.tags) {
      db.exec(
        `INSERT OR IGNORE INTO statuses_belonging_tags (compositeKey, tag)
         VALUES (?, ?);`,
        { bind: [compositeKey, t.name] },
      )
    }

    upsertMentionsInternal(db, compositeKey, status.mentions)

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['statuses'] }
}
