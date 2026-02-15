import Dexie from 'dexie'
import type { Entity } from 'megalodon'
import { db, type StoredNotification } from './database'
import { createCompositeKey } from './statusStore'

/**
 * Entity.NotificationをStoredNotificationに変換
 *
 * ※ appIndex はDBに永続化しない。
 * ※ created_at_ms は created_at（ISO 8601文字列）を UnixTime ミリ秒に変換した数値。
 */
export function toStoredNotification(
  notification: Entity.Notification,
  backendUrl: string,
): StoredNotification {
  return {
    ...notification,
    backendUrl,
    compositeKey: createCompositeKey(backendUrl, notification.id),
    created_at_ms: new Date(notification.created_at).getTime(),
    storedAt: Date.now(),
  }
}

/**
 * Notificationを追加
 */
export async function addNotification(
  notification: Entity.Notification,
  backendUrl: string,
): Promise<void> {
  const storedNotification = toStoredNotification(notification, backendUrl)
  await db.notifications.put(storedNotification)
}

/**
 * 複数のNotificationを一括追加
 */
export async function bulkAddNotifications(
  notifications: Entity.Notification[],
  backendUrl: string,
): Promise<void> {
  const storedNotifications = notifications.map((n) =>
    toStoredNotification(n, backendUrl),
  )
  await db.notifications.bulkPut(storedNotifications)
}

/**
 * Notificationを取得
 *
 * 複合インデックス [backendUrl+created_at_ms] を活用し、
 * DB側でソート済みの結果を返す。
 * created_at_ms は数値型のため、ソート順が確実に時系列となる。
 */
export async function getNotifications(
  backendUrls?: string[],
  limit?: number,
): Promise<StoredNotification[]> {
  if (backendUrls && backendUrls.length > 0) {
    const perUrlResults = await Promise.all(
      backendUrls.map((url) =>
        db.notifications
          .where('[backendUrl+created_at_ms]')
          .between([url, Dexie.minKey], [url, Dexie.maxKey])
          .reverse()
          .limit(limit ?? Number.MAX_SAFE_INTEGER)
          .toArray(),
      ),
    )
    const merged = perUrlResults.flat()
    return merged
      .sort((a, b) => b.created_at_ms - a.created_at_ms)
      .slice(0, limit)
  }

  const results = await db.notifications.toArray()
  return results
    .sort((a, b) => b.created_at_ms - a.created_at_ms)
    .slice(0, limit)
}

/**
 * Notification内のStatusアクション状態を更新
 */
export async function updateNotificationStatusAction(
  backendUrl: string,
  statusId: string,
  action: 'reblogged' | 'favourited' | 'bookmarked',
  value: boolean,
): Promise<void> {
  const notifications = await db.notifications
    .where('[backendUrl+created_at_ms]')
    .between([backendUrl, Dexie.minKey], [backendUrl, Dexie.maxKey])
    .filter((n) => n.status?.id === statusId)
    .toArray()

  if (notifications.length > 0) {
    await db.transaction('rw', db.notifications, async () => {
      for (const notification of notifications) {
        if (notification.status) {
          await db.notifications.update(notification.compositeKey, {
            status: { ...notification.status, [action]: value },
          })
        }
      }
    })
  }
}
