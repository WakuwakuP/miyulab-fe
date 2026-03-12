/**
 * Worker / メインスレッド共有の純粋関数
 *
 * DB アクセス不要な純粋関数をここに配置し、
 * Worker 側とメインスレッド側の両方から import できるようにする。
 */

import type { Entity } from 'megalodon'

/**
 * compositeKey を生成する
 *
 * @deprecated v7 以降は post_id (INTEGER PK) を使用。Dexie 互換用に残す。
 */
export function createCompositeKey(backendUrl: string, id: string): string {
  return `${backendUrl}:${id}`
}

/**
 * posts_backends から post_id を解決する
 *
 * backendUrl + localId から post_id を逆引きする。
 * 見つからない場合は null を返す。
 */
export function resolvePostId(
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  },
  backendUrl: string,
  localId: string,
): number | null {
  const rows = db.exec(
    'SELECT post_id FROM posts_backends WHERE backendUrl = ? AND local_id = ?;',
    { bind: [backendUrl, localId], returnValue: 'resultRows' },
  ) as number[][]
  return rows.length > 0 ? rows[0][0] : null
}

/**
 * Entity.Status から正規化カラムの値を抽出する
 */
export function extractStatusColumns(status: Entity.Status) {
  return {
    account_acct: status.account.acct,
    account_id: status.account.id,
    favourites_count: status.favourites_count,
    has_media: status.media_attachments.length > 0 ? 1 : 0,
    has_spoiler: (status.spoiler_text ?? '') !== '' ? 1 : 0,
    in_reply_to_id: status.in_reply_to_id ?? null,
    is_reblog: status.reblog != null ? 1 : 0,
    is_sensitive: status.sensitive ? 1 : 0,
    language: status.language ?? null,
    media_count: status.media_attachments.length,
    reblog_of_id: status.reblog?.id ?? null,
    reblog_of_uri: status.reblog?.uri ?? null,
    reblogs_count: status.reblogs_count,
    replies_count: status.replies_count,
    uri: status.uri,
    visibility: status.visibility,
  }
}

/**
 * Entity.Notification から正規化カラムの値を抽出する
 */
export function extractNotificationColumns(notification: Entity.Notification) {
  return {
    account_acct: notification.account?.acct ?? '',
    notification_type: notification.type,
    status_id: notification.status?.id ?? null,
  }
}

/**
 * backendUrl に対応する server_id を返す。
 * 未登録の場合は servers テーブルに INSERT してから返す。
 */
export function ensureServer(
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  },
  backendUrl: string,
): number {
  const host = new URL(backendUrl).host

  db.exec('INSERT OR IGNORE INTO servers (host, base_url) VALUES (?, ?);', {
    bind: [host, backendUrl],
  })

  const rows = db.exec('SELECT server_id FROM servers WHERE base_url = ?;', {
    bind: [backendUrl],
    returnValue: 'resultRows',
  }) as number[][]

  return rows[0][0]
}
