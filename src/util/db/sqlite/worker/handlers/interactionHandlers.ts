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

type PostIdentity = {
  canonicalUrl: string | null
  objectUri: string
  reblogOfPostId: number | null
}

function resolvePostIdentity(db: DbExec, postId: number): PostIdentity | null {
  const rows = db.exec(
    'SELECT object_uri, canonical_url, reblog_of_post_id FROM posts WHERE id = ?;',
    { bind: [postId], returnValue: 'resultRows' },
  ) as (string | number | null)[][]

  if (rows.length === 0) return null

  return {
    canonicalUrl: rows[0][1] as string | null,
    objectUri: (rows[0][0] as string | null) ?? '',
    reblogOfPostId: rows[0][2] as number | null,
  }
}

function resolveEquivalentPostIds(
  db: DbExec,
  postId: number,
  identity: PostIdentity,
): number[] {
  const rows = db.exec(
    `SELECT id FROM posts
     WHERE id != ?
       AND (
         (object_uri != '' AND object_uri = ?)
         OR (canonical_url IS NOT NULL AND canonical_url != '' AND canonical_url = ?)
       );`,
    {
      bind: [postId, identity.objectUri, identity.canonicalUrl],
      returnValue: 'resultRows',
    },
  ) as number[][]

  return rows.map((row) => row[0])
}

function enqueueRelatedPostId(
  related: Set<number>,
  pendingPostIds: number[],
  candidatePostId: number,
): void {
  if (related.has(candidatePostId)) return
  related.add(candidatePostId)
  pendingPostIds.push(candidatePostId)
}

function enqueueIdentityRelations(
  db: DbExec,
  nextPostId: number,
  related: Set<number>,
  pendingPostIds: number[],
  sourcePostIds: Set<number>,
): void {
  const identity = resolvePostIdentity(db, nextPostId)
  if (!identity) return

  const sourcePostId = identity.reblogOfPostId ?? nextPostId
  sourcePostIds.add(sourcePostId)
  if (identity.reblogOfPostId != null) {
    enqueueRelatedPostId(related, pendingPostIds, identity.reblogOfPostId)
  }

  for (const equivalentPostId of resolveEquivalentPostIds(
    db,
    nextPostId,
    identity,
  )) {
    enqueueRelatedPostId(related, pendingPostIds, equivalentPostId)
  }
}

function enqueueSourceReblogs(
  db: DbExec,
  sourcePostId: number,
  related: Set<number>,
  pendingPostIds: number[],
): void {
  const reblogRows = db.exec(
    'SELECT id FROM posts WHERE reblog_of_post_id = ?;',
    { bind: [sourcePostId], returnValue: 'resultRows' },
  ) as number[][]
  for (const row of reblogRows) {
    enqueueRelatedPostId(related, pendingPostIds, row[0])
  }
}

function resolveRelatedInteractionPostIds(
  db: DbExec,
  postId: number,
): number[] {
  const related = new Set<number>()
  const pendingPostIds: number[] = []
  const sourcePostIds = new Set<number>()
  const processedSourcePostIds = new Set<number>()

  enqueueRelatedPostId(related, pendingPostIds, postId)

  while (pendingPostIds.length > 0 || sourcePostIds.size > 0) {
    const nextPostId = pendingPostIds.shift()
    if (nextPostId !== undefined) {
      enqueueIdentityRelations(
        db,
        nextPostId,
        related,
        pendingPostIds,
        sourcePostIds,
      )
      continue
    }

    const sourcePostId = [...sourcePostIds].find(
      (id) => !processedSourcePostIds.has(id),
    )
    if (sourcePostId === undefined) break
    processedSourcePostIds.add(sourcePostId)

    enqueueSourceReblogs(db, sourcePostId, related, pendingPostIds)
  }

  return [...related]
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

  for (const relatedPostId of resolveRelatedInteractionPostIds(db, postId)) {
    updateInteraction(
      db,
      relatedPostId,
      localAccountId,
      normalizedAction,
      value,
      undefined,
      { recordLocalAction: true },
    )
  }

  return { changedTables: ['post_interactions'] }
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
  const relatedPostIds = resolveRelatedInteractionPostIds(db, postId)

  // value=false の場合はリアクションをクリア
  if (!value) {
    for (const relatedPostId of relatedPostIds) {
      toggleReaction(db, relatedPostId, localAccountId, null, null)
    }
    return { changedTables: ['post_interactions'] }
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
    for (const relatedPostId of relatedPostIds) {
      toggleReaction(db, relatedPostId, localAccountId, shortcode, url)
    }
  } else {
    // Unicode 絵文字
    for (const relatedPostId of relatedPostIds) {
      toggleReaction(db, relatedPostId, localAccountId, emoji, null)
    }
  }

  return { changedTables: ['post_interactions'] }
}
