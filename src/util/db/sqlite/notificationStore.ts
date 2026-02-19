/**
 * SQLite ベースの Notification ストア
 *
 * v2 スキーマでは正規化カラム（notification_type, status_id, account_acct）を
 * 追加・更新時に同時に書き込み、フィルタ / 逆引きに利用する。
 *
 * v3 スキーマでは statuses_backends テーブルを利用した compositeKey 解決を行う。
 *
 * Worker モードでは write 系は sendCommand で Worker に委譲し、
 * read 系は execAsync で直接クエリを発行する。
 */

import type { Entity } from 'megalodon'
import { getSqliteDb } from './connection'

/** クエリの最大行数上限 */
const MAX_QUERY_LIMIT = 2147483647

export interface SqliteStoredNotification extends Entity.Notification {
  compositeKey: string
  backendUrl: string
  created_at_ms: number
  storedAt: number
}

/**
 * Entity.Notification から正規化カラムの値を抽出する
 *
 * UPSERT 時に使用する。
 * (shared.ts の extractNotificationColumns と同等だが互換性のため残す)
 */
export { extractNotificationColumns } from './shared'

function rowToStoredNotification(
  row: (string | number)[],
): SqliteStoredNotification {
  const compositeKey = row[0] as string
  const backendUrl = row[1] as string
  const created_at_ms = row[2] as number
  const storedAt = row[3] as number
  const json = row[4] as string
  const notification = JSON.parse(json) as Entity.Notification

  return {
    ...notification,
    backendUrl,
    compositeKey,
    created_at_ms,
    storedAt,
  }
}

/**
 * Notification を追加 — Worker に委譲
 */
export async function addNotification(
  notification: Entity.Notification,
  backendUrl: string,
): Promise<void> {
  const handle = await getSqliteDb()
  await handle.sendCommand({
    backendUrl,
    notificationJson: JSON.stringify(notification),
    type: 'addNotification',
  })
}

/**
 * 複数の Notification を一括追加 — Worker に委譲
 */
export async function bulkAddNotifications(
  notifications: Entity.Notification[],
  backendUrl: string,
): Promise<void> {
  if (notifications.length === 0) return

  const handle = await getSqliteDb()
  await handle.sendCommand({
    backendUrl,
    notificationsJson: notifications.map((n) => JSON.stringify(n)),
    type: 'bulkAddNotifications',
  })
}

/**
 * Notification を取得 — execAsync で直接クエリ
 */
export async function getNotifications(
  backendUrls?: string[],
  limit?: number,
): Promise<SqliteStoredNotification[]> {
  const handle = await getSqliteDb()

  let sql: string
  const binds: (string | number)[] = []

  if (backendUrls && backendUrls.length > 0) {
    const placeholders = backendUrls.map(() => '?').join(',')
    sql = `
      SELECT compositeKey, backendUrl, created_at_ms, storedAt, json
      FROM notifications
      WHERE backendUrl IN (${placeholders})
      ORDER BY created_at_ms DESC
      LIMIT ?;
    `
    binds.push(...backendUrls, limit ?? MAX_QUERY_LIMIT)
  } else {
    sql = `
      SELECT compositeKey, backendUrl, created_at_ms, storedAt, json
      FROM notifications
      ORDER BY created_at_ms DESC
      LIMIT ?;
    `
    binds.push(limit ?? MAX_QUERY_LIMIT)
  }

  const rows = (await handle.execAsync(sql, {
    bind: binds,
    returnValue: 'resultRows',
  })) as (string | number)[][]

  return rows.map(rowToStoredNotification)
}

/**
 * Notification 内の Status アクション状態を更新 — Worker に委譲
 *
 * v3: statusId は特定バックエンドのローカル ID のため、
 * statuses_backends 経由でグローバルな status を特定し、
 * その status.uri に紐づく通知も含めて更新する。
 */
export async function updateNotificationStatusAction(
  backendUrl: string,
  statusId: string,
  action: 'reblogged' | 'favourited' | 'bookmarked',
  value: boolean,
): Promise<void> {
  const handle = await getSqliteDb()
  await handle.sendCommand({
    action,
    backendUrl,
    statusId,
    type: 'updateNotificationStatusAction',
    value,
  })
}
