/**
 * インタラクション関連のハンドラ群
 *
 * workerStatusStore.ts から分割。ロジック変更なし。
 */

import {
  ACTION_TO_ENGAGEMENT,
  ensureServer,
  resolveLocalAccountId,
  toggleEngagement,
  toggleReaction,
} from '../../shared'
import { resolvePostIdInternal } from './statusHelpers'
import type { DbExec, HandlerResult } from './types'

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

export function handleToggleReaction(
  db: DbExec,
  backendUrl: string,
  statusId: string,
  value: boolean,
  emoji: string,
): HandlerResult {
  const postId = resolvePostIdInternal(db, backendUrl, statusId)
  if (postId === null) return { changedTables: [] }

  const localAccountId = resolveLocalAccountId(db, backendUrl)
  if (localAccountId === null) return { changedTables: [] }

  const isCustom = emoji.startsWith(':') && emoji.endsWith(':')

  let emojiId: number | null = null
  let emojiText: string | null = null

  if (isCustom) {
    // カスタム絵文字: shortcode から custom_emojis を検索
    const shortcode = emoji.slice(1, -1)
    const serverId = ensureServer(db, backendUrl)
    const rows = db.exec(
      'SELECT emoji_id FROM custom_emojis WHERE server_id = ? AND shortcode = ?;',
      { bind: [serverId, shortcode], returnValue: 'resultRows' },
    ) as number[][]
    if (rows.length > 0) {
      emojiId = rows[0][0]
    } else {
      // custom_emojis に見つからない場合は shortcode を emoji_text に保存
      emojiText = shortcode
    }
  } else {
    // Unicode 絵文字
    emojiText = emoji
  }

  toggleReaction(db, localAccountId, postId, value, emojiId, emojiText)

  return { changedTables: ['posts'] }
}
