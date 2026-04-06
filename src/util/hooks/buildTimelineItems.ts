/**
 * GraphPlan 実行結果をタイムラインアイテムに変換するユーティリティ
 *
 * posts の detailRows/batchResults → StatusAddAppIndex,
 * notifications の detailRows → NotificationAddAppIndex に変換し、
 * displayOrder 順に組み立てる。
 */

import type { NotificationAddAppIndex, StatusAddAppIndex } from 'types/types'
import type { GraphExecuteResult } from 'util/db/query-ir/executor/types'
import { rowToStoredNotification } from 'util/db/sqlite/notificationStore'
import {
  assembleStatusFromBatch,
  buildBatchMapsFromResults,
} from 'util/db/sqlite/statusStore'

export type TimelineItemFromGraph = StatusAddAppIndex | NotificationAddAppIndex

/**
 * appIndex を解決する
 */
function resolveAppIndex(
  backendUrl: string,
  apps: { backendUrl: string }[],
): number {
  return apps.findIndex((app) => app.backendUrl === backendUrl)
}

/**
 * GraphExecuteResult をタイムラインアイテム配列に変換する。
 *
 * @param result - GraphPlan 実行結果
 * @param apps - バックエンドアプリ一覧 (appIndex 解決用)
 * @param targetBackendUrls - 対象バックエンド URL (backendUrl 空欄時のフォールバック用)
 * @returns displayOrder 順のタイムラインアイテム配列
 */
export function buildTimelineItemsFromGraphResult(
  result: GraphExecuteResult,
  apps: { backendUrl: string }[],
  targetBackendUrls: string[],
): TimelineItemFromGraph[] {
  // --- posts の変換 ---
  let postMap: Map<number, StatusAddAppIndex> | undefined
  if (result.posts.detailRows.length > 0) {
    const maps = buildBatchMapsFromResults(
      result.posts.batchResults as Parameters<
        typeof buildBatchMapsFromResults
      >[0],
    )
    const fallbackAppIndex =
      targetBackendUrls.length > 0
        ? resolveAppIndex(targetBackendUrls[0], apps)
        : -1
    postMap = new Map()
    for (const row of result.posts.detailRows) {
      const status = assembleStatusFromBatch(row, maps)
      let appIndex = resolveAppIndex(status.backendUrl, apps)
      if (appIndex < 0 && status.backendUrl === '' && fallbackAppIndex >= 0) {
        appIndex = fallbackAppIndex
        status.backendUrl = targetBackendUrls[0]
      }
      if (appIndex < 0) continue
      postMap.set(status.post_id, { ...status, appIndex })
    }
  }

  // --- notifications の変換 ---
  let notifMap: Map<number, NotificationAddAppIndex> | undefined
  if (result.notifications.detailRows.length > 0) {
    notifMap = new Map()
    for (const row of result.notifications.detailRows) {
      const backendUrl = (row[1] as string) || ''
      const appIndex = resolveAppIndex(backendUrl, apps)
      if (appIndex < 0) continue
      const stored = rowToStoredNotification(row)
      notifMap.set(stored.notification_id, { ...stored, appIndex })
    }
  }

  // --- displayOrder に基づいて結果を組み立て ---
  const items: TimelineItemFromGraph[] = []
  for (const entry of result.displayOrder) {
    if (entry.table === 'posts' && postMap) {
      const status = postMap.get(entry.id)
      if (status) items.push(status)
    } else if (entry.table === 'notifications' && notifMap) {
      const notif = notifMap.get(entry.id)
      if (notif) items.push(notif)
    }
  }

  return items
}
