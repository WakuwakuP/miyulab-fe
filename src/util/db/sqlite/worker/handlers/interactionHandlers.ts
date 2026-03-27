/**
 * インタラクション関連のハンドラ群
 *
 * 新スキーマ (v2) 対応版:
 *   - updateInteraction / toggleReaction を helpers から使用
 *   - resolvePostIdInternal(db, localAccountId, localId) で post_id 解決
 *   - posts.reblog_of_post_id でリブログチェーン処理
 *   - custom_emojis.id（旧 emoji_id）
 */

import { toggleReaction, updateInteraction } from '../../helpers'
import { resolvePostIdInternal } from './statusHelpers'
import type { DbExec, HandlerResult } from './types'

/** 旧アクション名 → 新アクション名のマッピング */
const ACTION_NAME_MAP: Record<string, string> = {
  bookmarked: 'bookmark',
  favourited: 'favourite',
  reblogged: 'reblog',
}

export function handleUpdateStatusAction(
  db: DbExec,
  localAccountId: number,
  localId: string,
  action: 'reblogged' | 'favourited' | 'bookmarked',
  value: boolean,
): HandlerResult {
  const postId = resolvePostIdInternal(db, localAccountId, localId)
  if (postId === undefined) return { changedTables: [] }

  const normalizedAction = ACTION_NAME_MAP[action]
  if (!normalizedAction) return { changedTables: [] }

  // 自分自身のインタラクションを更新
  updateInteraction(db, postId, localAccountId, normalizedAction, value)

  // リブログチェーン: reblog_of_post_id から関連投稿を更新
  const postInfo = db.exec(
    'SELECT reblog_of_post_id FROM posts WHERE id = ?;',
    { bind: [postId], returnValue: 'resultRows' },
  ) as (number | null)[][]

  if (postInfo.length > 0) {
    const reblogOfPostId = postInfo[0][0]

    // リブログ元の投稿もインタラクションを伝播
    if (reblogOfPostId != null) {
      updateInteraction(
        db,
        reblogOfPostId,
        localAccountId,
        normalizedAction,
        value,
      )
    }

    // このポストを reblog している他の投稿にも伝播
    const reblogRows = db.exec(
      'SELECT id FROM posts WHERE reblog_of_post_id = ?;',
      { bind: [postId], returnValue: 'resultRows' },
    ) as number[][]
    for (const row of reblogRows) {
      updateInteraction(db, row[0], localAccountId, normalizedAction, value)
    }
  }

  return { changedTables: ['posts'] }
}

export function handleToggleReaction(
  db: DbExec,
  localAccountId: number,
  localId: string,
  value: boolean,
  emoji: string,
): HandlerResult {
  const postId = resolvePostIdInternal(db, localAccountId, localId)
  if (postId === undefined) return { changedTables: [] }

  // value=false の場合はリアクションをクリア
  if (!value) {
    toggleReaction(db, postId, localAccountId, null, null)
    return { changedTables: ['posts'] }
  }

  const isCustom = emoji.startsWith(':') && emoji.endsWith(':')

  if (isCustom) {
    // カスタム絵文字: shortcode から custom_emojis を検索して url を解決
    const shortcode = emoji.slice(1, -1)
    const rows = db.exec(
      'SELECT id, url FROM custom_emojis WHERE server_id = (SELECT server_id FROM local_accounts WHERE id = ?) AND shortcode = ?;',
      { bind: [localAccountId, shortcode], returnValue: 'resultRows' },
    ) as (number | string)[][]

    const url = rows.length > 0 ? (rows[0][1] as string) : null
    toggleReaction(db, postId, localAccountId, shortcode, url)
  } else {
    // Unicode 絵文字
    toggleReaction(db, postId, localAccountId, emoji, null)
  }

  return { changedTables: ['posts'] }
}
