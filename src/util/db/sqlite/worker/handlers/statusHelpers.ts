/**
 * Status 関連の内部ヘルパー関数群（基本ヘルパー）
 *
 * workerStatusStore.ts から分割。ロジック変更なし。
 * 投稿データ同期処理は postSync.ts に移動。
 */

import type { Entity } from 'megalodon'
import type { DbExec } from './types'

// マスターデータキャッシュ（セッション中不変）
export const visibilityCache = new Map<string, number | null>()
export const mediaTypeCache = new Map<string, number>()
export let cachedPostItemKindId: number | null = null

export function setCachedPostItemKindId(value: number): void {
  cachedPostItemKindId = value
}

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

export function resolvePostIdInternal(
  db: DbExec,
  backendUrl: string,
  localId: string,
): number | null {
  const rows = db.exec(
    'SELECT post_id FROM posts_backends WHERE server_id = (SELECT server_id FROM servers WHERE base_url = ?) AND local_id = ?;',
    { bind: [backendUrl, localId], returnValue: 'resultRows' },
  ) as number[][]
  return rows.length > 0 ? rows[0][0] : null
}

export function getLastInsertRowId(db: DbExec): number {
  return (
    db.exec('SELECT last_insert_rowid();', {
      returnValue: 'resultRows',
    }) as number[][]
  )[0][0]
}

export function resolveVisibilityId(
  db: DbExec,
  visibility: string,
): number | null {
  const cached = visibilityCache.get(visibility)
  if (cached !== undefined) return cached
  const rows = db.exec(
    'SELECT visibility_id FROM visibility_types WHERE code = ?;',
    { bind: [visibility], returnValue: 'resultRows' },
  ) as number[][]
  const result = rows.length > 0 ? rows[0][0] : null
  if (result !== null) visibilityCache.set(visibility, result)
  return result
}

export function resolveMediaTypeId(db: DbExec, mediaType: string): number {
  const cached = mediaTypeCache.get(mediaType)
  if (cached !== undefined) return cached
  const rows = db.exec(
    'SELECT media_type_id FROM media_types WHERE code = ?;',
    { bind: [mediaType], returnValue: 'resultRows' },
  ) as number[][]
  if (rows.length > 0) {
    mediaTypeCache.set(mediaType, rows[0][0])
    return rows[0][0]
  }
  const fallback = db.exec(
    "SELECT media_type_id FROM media_types WHERE code = 'unknown';",
    { returnValue: 'resultRows' },
  ) as number[][]
  mediaTypeCache.set(mediaType, fallback[0][0])
  return fallback[0][0]
}

/**
 * in_reply_to_id (server-local ID) から reply_to_post_id (internal FK) を解決する。
 * posts_backends 経由で post_id を逆引きする。
 */
export function resolveReplyToPostId(
  db: DbExec,
  inReplyToId: string | null,
  serverId: number,
): number | null {
  if (!inReplyToId) return null
  const rows = db.exec(
    'SELECT post_id FROM posts_backends WHERE server_id = ? AND local_id = ? LIMIT 1;',
    { bind: [serverId, inReplyToId], returnValue: 'resultRows' },
  ) as number[][]
  return rows.length > 0 ? rows[0][0] : null
}

/**
 * reblog_of_uri (ActivityPub URI) から repost_of_post_id (internal FK) を解決する。
 * posts.object_uri 経由で post_id を逆引きする。
 */
export function resolveRepostOfPostId(
  db: DbExec,
  reblogOfUri: string | null,
): number | null {
  if (!reblogOfUri) return null
  const rows = db.exec(
    "SELECT post_id FROM posts WHERE object_uri = ? AND object_uri != '' LIMIT 1;",
    { bind: [reblogOfUri], returnValue: 'resultRows' },
  ) as number[][]
  return rows.length > 0 ? rows[0][0] : null
}

// ================================================================
// 後方互換リエクスポート（postSync.ts に移動した関数群）
// ================================================================
export {
  ensureReblogOriginalPost,
  resolveDelayedReplyReferences,
  resolveDelayedRepostReferences,
  syncPostMedia,
  syncPostStats,
  upsertMentionsInternal,
} from './postSync'
