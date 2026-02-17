/**
 * SQLite ベースの Notification ストア
 *
 * v2 スキーマでは正規化カラム（notification_type, status_id, account_acct）を
 * 追加・更新時に同時に書き込み、フィルタ / 逆引きに利用する。
 *
 * v3 スキーマでは statuses_backends テーブルを利用した compositeKey 解決を行う。
 */

import type { Entity } from 'megalodon'
import { getSqliteDb, notifyChange } from './connection'
import { createCompositeKey, resolveCompositeKey } from './statusStore'

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
 */
export function extractNotificationColumns(notification: Entity.Notification) {
  return {
    account_acct: notification.account?.acct ?? '',
    notification_type: notification.type,
    status_id: notification.status?.id ?? null,
  }
}

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
 * Notification を追加
 */
export async function addNotification(
  notification: Entity.Notification,
  backendUrl: string,
): Promise<void> {
  const handle = await getSqliteDb()
  const { db } = handle
  const compositeKey = createCompositeKey(backendUrl, notification.id)
  const created_at_ms = new Date(notification.created_at).getTime()
  const now = Date.now()

  const cols = extractNotificationColumns(notification)

  db.exec(
    `INSERT INTO notifications (
      compositeKey, backendUrl, created_at_ms, storedAt,
      notification_type, status_id, account_acct,
      json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(compositeKey) DO UPDATE SET
      created_at_ms     = excluded.created_at_ms,
      storedAt          = excluded.storedAt,
      notification_type = excluded.notification_type,
      status_id         = excluded.status_id,
      account_acct      = excluded.account_acct,
      json              = excluded.json;`,
    {
      bind: [
        compositeKey,
        backendUrl,
        created_at_ms,
        now,
        cols.notification_type,
        cols.status_id,
        cols.account_acct,
        JSON.stringify(notification),
      ],
    },
  )

  notifyChange('notifications')
}

/**
 * 複数の Notification を一括追加
 */
export async function bulkAddNotifications(
  notifications: Entity.Notification[],
  backendUrl: string,
): Promise<void> {
  if (notifications.length === 0) return

  const handle = await getSqliteDb()
  const { db } = handle
  const now = Date.now()

  db.exec('BEGIN;')
  try {
    for (const notification of notifications) {
      const compositeKey = createCompositeKey(backendUrl, notification.id)
      const created_at_ms = new Date(notification.created_at).getTime()
      const cols = extractNotificationColumns(notification)

      db.exec(
        `INSERT INTO notifications (
          compositeKey, backendUrl, created_at_ms, storedAt,
          notification_type, status_id, account_acct,
          json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(compositeKey) DO UPDATE SET
          created_at_ms     = excluded.created_at_ms,
          storedAt          = excluded.storedAt,
          notification_type = excluded.notification_type,
          status_id         = excluded.status_id,
          account_acct      = excluded.account_acct,
          json              = excluded.json;`,
        {
          bind: [
            compositeKey,
            backendUrl,
            created_at_ms,
            now,
            cols.notification_type,
            cols.status_id,
            cols.account_acct,
            JSON.stringify(notification),
          ],
        },
      )
    }
    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  notifyChange('notifications')
}

/**
 * Notification を取得
 */
export async function getNotifications(
  backendUrls?: string[],
  limit?: number,
): Promise<SqliteStoredNotification[]> {
  const handle = await getSqliteDb()
  const { db } = handle

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

  const rows = db.exec(sql, {
    bind: binds,
    returnValue: 'resultRows',
  }) as (string | number)[][]

  return rows.map(rowToStoredNotification)
}

/**
 * Notification 内の Status アクション状態を更新
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
  const { db } = handle

  // v3: statuses_backends 経由で status の uri を取得し、
  // その uri に対応する全ての status_id（ローカル ID）を収集して通知を検索する。
  // これにより跨サーバーで同一投稿に対する通知も正しく更新できる。
  const statusCompositeKey = resolveCompositeKey(handle, backendUrl, statusId)

  // 検索対象の status_id リストを構築
  const statusIds: string[] = [statusId]

  if (statusCompositeKey) {
    // 同一投稿の他バックエンドでの local_id も収集
    const localIdRows = db.exec(
      'SELECT local_id FROM statuses_backends WHERE compositeKey = ?;',
      { bind: [statusCompositeKey], returnValue: 'resultRows' },
    ) as string[][]
    for (const r of localIdRows) {
      if (!statusIds.includes(r[0])) {
        statusIds.push(r[0])
      }
    }
  }

  // 収集した全 status_id で通知を検索
  const placeholders = statusIds.map(() => '?').join(',')
  const rows = db.exec(
    `SELECT compositeKey, json FROM notifications
     WHERE status_id IN (${placeholders});`,
    { bind: statusIds, returnValue: 'resultRows' },
  ) as (string | number)[][]

  const updates: { key: string; json: string }[] = []
  for (const row of rows) {
    const notification = JSON.parse(row[1] as string) as Entity.Notification
    if (notification.status) {
      ;(notification.status as Record<string, unknown>)[action] = value
      updates.push({
        json: JSON.stringify(notification),
        key: row[0] as string,
      })
    }
  }

  if (updates.length > 0) {
    db.exec('BEGIN;')
    try {
      for (const u of updates) {
        db.exec('UPDATE notifications SET json = ? WHERE compositeKey = ?;', {
          bind: [u.json, u.key],
        })
      }
      db.exec('COMMIT;')
    } catch (e) {
      db.exec('ROLLBACK;')
      throw e
    }
    notifyChange('notifications')
  }
}
