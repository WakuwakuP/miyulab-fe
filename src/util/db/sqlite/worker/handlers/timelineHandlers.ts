/**
 * タイムライン関連のハンドラ群
 *
 * workerStatusStore.ts から分割。ロジック変更なし。
 */

import { ensureServer } from '../../shared'
import { resolvePostIdInternal } from './statusHelpers'
import type { DbExec, HandlerResult } from './types'

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
      const normalizedTag = tag.toLowerCase()
      db.exec(
        `DELETE FROM post_hashtags WHERE post_id = ? AND hashtag_id = (
          SELECT hashtag_id FROM hashtags WHERE normalized_name = ?
        );`,
        { bind: [postId, normalizedTag] },
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
      'DELETE FROM posts_backends WHERE server_id = (SELECT server_id FROM servers WHERE base_url = ?) AND local_id = ?;',
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
        const normalizedTag = tag.toLowerCase()
        db.exec(
          `DELETE FROM post_hashtags WHERE post_id = ? AND hashtag_id = (
            SELECT hashtag_id FROM hashtags WHERE normalized_name = ?
          );`,
          { bind: [postId, normalizedTag] },
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
