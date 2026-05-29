/**
 * タイムラインアイテムの識別・タイムスタンプ取得ヘルパー
 *
 * useTimelineList から抽出した純粋関数群。
 * 単体テスト可能な形で、アイテムの一意キー生成とタイムスタンプ取得を提供する。
 */

import type { TimelineItem } from 'util/hooks/useTimelineDataSource'

/** 差分取得の安全マージン (同一 ms に複数アイテムがある場合の取りこぼし防止) */
export const CURSOR_MARGIN_MS = 1

/** post_id / notification_id を数値として解釈する（itemKey と itemNumericId で共通） */
function timelineNumericField(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isNaN(parsed)) return parsed
  }
  return null
}

/** status を持つべき通知タイプ */
export const TYPES_WITH_STATUS = new Set([
  'emoji_reaction',
  'favourite',
  'mention',
  'poll',
  'poll_expired',
  'reblog',
  'status',
  'update',
])

/** アイテムの一意キーを生成 */
export function itemKey(item: TimelineItem): string {
  if ('post_id' in item) {
    const postId = timelineNumericField(item.post_id)
    if (postId != null) return `p:${postId}`
  }
  if ('notification_id' in item) {
    const notificationId = timelineNumericField(item.notification_id)
    if (notificationId != null) return `n:${notificationId}`
  }
  return `u:${item.id}`
}

/** アイテムの created_at_ms を取得 */
export function itemTimestamp(item: TimelineItem): number {
  if ('created_at_ms' in item) return item.created_at_ms as number
  // fallback: parse ISO 8601 created_at
  if ('created_at' in item && typeof item.created_at === 'string') {
    return new Date(item.created_at).getTime()
  }
  return 0
}

/** アイテムの数値 ID を取得 (post_id or notification_id → parseInt(id) フォールバック) */
export function itemNumericId(item: TimelineItem): number {
  if ('post_id' in item) {
    const postId = timelineNumericField(item.post_id)
    if (postId != null) return postId
  }
  if ('notification_id' in item) {
    const notificationId = timelineNumericField(item.notification_id)
    if (notificationId != null) return notificationId
  }
  const parsed = Number.parseInt(item.id, 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * アイテム群を Map にマージし、カーソル (newest/oldest) を更新する。
 *
 * @returns 変更があった場合 true
 */
export function mergeItemsIntoMap(
  itemMap: Map<string, TimelineItem>,
  newItems: TimelineItem[],
  cursors: { newestMs: number; oldestMs: number },
): boolean {
  if (newItems.length === 0) return false
  let changed = false
  for (const item of newItems) {
    const key = itemKey(item)
    itemMap.set(key, item)
    changed = true

    const ts = itemTimestamp(item)
    if (ts > cursors.newestMs) cursors.newestMs = ts
    if (ts < cursors.oldestMs) cursors.oldestMs = ts
  }
  return changed
}

/** アイテムを created_at_ms の降順でソートした新配列を返す */
export function sortItemsDesc(items: TimelineItem[]): TimelineItem[] {
  const sorted = [...items]
  sorted.sort((a, b) => itemTimestamp(b) - itemTimestamp(a))
  return sorted
}
