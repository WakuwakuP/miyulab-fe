import type { Entity } from 'megalodon'
import type { SqliteStoredStatus, TimelineType } from './statusMapperTypes'

/**
 * Entity.Status を StoredStatus 互換に変換して返す（保存は行わない）
 */
export function toStoredStatus(
  status: Entity.Status,
  backendUrl: string,
  timelineTypes: TimelineType[],
): SqliteStoredStatus {
  return {
    ...status,
    backendUrl,
    belongingTags: status.tags.map((tag) => tag.name),
    created_at_ms: new Date(status.created_at).getTime(),
    edited_at_ms: status.edited_at
      ? new Date(status.edited_at).getTime()
      : null,
    post_id: 0,
    timelineTypes,
  }
}
