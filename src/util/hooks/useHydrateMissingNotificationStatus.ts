/**
 * useHydrateMissingNotificationStatus
 *
 * 通知アイテムに status が欠落している場合、
 * REST API から個別取得して DB に書き戻す。
 * DB 更新後は通常の変更通知フローで UI に反映される。
 */

import { useContext, useEffect, useRef } from 'react'

import type { NotificationAddAppIndex } from 'types/types'
import { addNotification } from 'util/db/sqlite/notificationStore'
import { GetClient } from 'util/GetClient'
import { TYPES_WITH_STATUS } from 'util/hooks/timelineList'
import type { TimelineItem } from 'util/hooks/useTimelineDataSource'
import { AppsContext } from 'util/provider/AppsProvider'

type NotifWithBackend = NotificationAddAppIndex & { backendUrl: string }

/**
 * 通知タイムラインで status が欠落している通知を検出し、
 * 個別に REST API から取得して DB に書き戻す。
 *
 * @param items - 現在のタイムラインアイテム配列
 * @param timelineType - タイムライン種別 ('notification' 以外では何もしない)
 */
export function useHydrateMissingNotificationStatus(
  items: TimelineItem[],
  timelineType: string,
): void {
  const apps = useContext(AppsContext)
  const fetchedNotifIdsRef = useRef(new Set<string>())

  useEffect(() => {
    if (timelineType !== 'notification') return

    const notifications = items.filter(
      (item): item is NotifWithBackend =>
        'type' in item && 'backendUrl' in item,
    )
    const missing = notifications.filter(
      (n) =>
        n.status === undefined &&
        TYPES_WITH_STATUS.has(n.type) &&
        !fetchedNotifIdsRef.current.has(`${n.backendUrl}:${n.id}`),
    )
    if (missing.length === 0) return

    for (const n of missing) {
      const key = `${n.backendUrl}:${n.id}`
      fetchedNotifIdsRef.current.add(key)

      const app = apps.find((a) => a.backendUrl === n.backendUrl)
      if (!app) continue

      const client = GetClient(app)
      client
        .getNotification(n.id)
        .then((res) => addNotification(res.data, n.backendUrl))
        .catch((err) =>
          console.warn('Failed to fetch notification status:', err),
        )
    }
  }, [items, apps, timelineType])
}
