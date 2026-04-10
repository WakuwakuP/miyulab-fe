/**
 * Status 関連の内部ヘルパー関数群（基本ヘルパー）
 *
 * workerStatusStore.ts から分割。
 * 新スキーマ (v2) 対応版:
 *   - posts_backends → post_backend_ids (local_account_id + local_id)
 *   - visibility_types: visibility_id/code → id/name
 *   - media_types: media_type_id/code → id/name
 *   - posts PK: post_id → id
 *   - cachedPostItemKindId / setCachedPostItemKindId 削除
 */

import type { Entity } from 'megalodon'
import type { DbExec } from './types'

// マスターデータキャッシュ（セッション中不変）
export const visibilityCache = new Map<string, number | null>()
export const mediaTypeCache = new Map<string, number>()

// ================================================================
// 内部ヘルパー
// ================================================================

/**
 * アカウントのドメインを統一的に取得する。
 * - acct に @ が含まれる場合（リモートユーザー）: @ 以降を使用
 * - acct に @ がない場合（ローカルユーザー）: account.url からホスト名を抽出
 *
 * Pleroma はローカルユーザーの acct にドメインを含めないが、
 * Misskey マッパーは常に `username@host` 形式を返す。
 * この関数で両者を統一的に扱う。
 */
export function deriveAccountDomain(account: Entity.Account): string {
  if (account.acct.includes('@')) {
    return account.acct.split('@')[1]
  }
  try {
    return new URL(account.url).hostname
  } catch {
    return ''
  }
}

/**
 * local_account_id + local_id から内部 post_id を解決する。
 * 見つからない場合は undefined を返す。
 */
export function resolvePostIdInternal(
  db: DbExec,
  localAccountId: number,
  localId: string,
): number | undefined {
  const rows = db.exec(
    'SELECT post_id FROM post_backend_ids WHERE local_account_id = ? AND local_id = ?;',
    { bind: [localAccountId, localId], returnValue: 'resultRows' },
  ) as number[][]
  return rows.length > 0 ? rows[0][0] : undefined
}

export function getLastInsertRowId(db: DbExec): number {
  const rows = db.exec('SELECT last_insert_rowid();', {
    returnValue: 'resultRows',
  }) as number[][]
  if (rows.length === 0 || rows[0] === undefined) {
    throw new Error('last_insert_rowid() returned no rows')
  }
  return rows[0][0]
}

export function resolveVisibilityId(
  db: DbExec,
  visibility: string,
): number | null {
  const cached = visibilityCache.get(visibility)
  if (cached !== undefined) return cached
  const rows = db.exec('SELECT id FROM visibility_types WHERE name = ?;', {
    bind: [visibility],
    returnValue: 'resultRows',
  }) as number[][]
  const result = rows.length > 0 ? rows[0][0] : null
  if (result !== null) visibilityCache.set(visibility, result)
  return result
}

export function resolveMediaTypeId(db: DbExec, mediaType: string): number {
  const cached = mediaTypeCache.get(mediaType)
  if (cached !== undefined) return cached
  const rows = db.exec('SELECT id FROM media_types WHERE name = ?;', {
    bind: [mediaType],
    returnValue: 'resultRows',
  }) as number[][]
  if (rows.length > 0) {
    mediaTypeCache.set(mediaType, rows[0][0])
    return rows[0][0]
  }
  const fallback = db.exec(
    "SELECT id FROM media_types WHERE name = 'unknown';",
    { returnValue: 'resultRows' },
  ) as number[][]
  if (fallback.length === 0 || fallback[0] === undefined) {
    throw new Error(
      `media_types table missing 'unknown' entry (lookup for: ${mediaType})`,
    )
  }
  mediaTypeCache.set(mediaType, fallback[0][0])
  return fallback[0][0]
}

/**
 * in_reply_to_id (server-local ID) から reply_to_post_id (internal FK) を解決する。
 * post_backend_ids 経由で post_id を逆引きする。
 */
export function resolveReplyToPostId(
  db: DbExec,
  inReplyToId: string | null,
  localAccountId: number,
): number | null {
  if (!inReplyToId) return null
  const rows = db.exec(
    'SELECT post_id FROM post_backend_ids WHERE local_account_id = ? AND local_id = ? LIMIT 1;',
    { bind: [localAccountId, inReplyToId], returnValue: 'resultRows' },
  ) as number[][]
  return rows.length > 0 ? rows[0][0] : null
}

/**
 * reblog_of_uri (ActivityPub URI) から repost_of_post_id (internal FK) を解決する。
 * posts.object_uri 経由で id を逆引きする。
 */
export function resolveRepostOfPostId(
  db: DbExec,
  reblogOfUri: string | null,
): number | null {
  if (!reblogOfUri) return null
  const rows = db.exec(
    "SELECT id FROM posts WHERE object_uri = ? AND object_uri != '' LIMIT 1;",
    { bind: [reblogOfUri], returnValue: 'resultRows' },
  ) as number[][]
  return rows.length > 0 ? rows[0][0] : null
}

// ================================================================
// 後方互換リエクスポート（postSync.ts に移動した関数群）
// ================================================================
export {
  ensureReblogOriginalPost,
  syncPostMedia,
  syncPostStats,
  upsertMentionsInternal,
} from './postSync'
