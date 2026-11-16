import type { TimelineSettingsV2 } from 'types/types'

/**
 * V2 設定かどうかを判定する型ガード
 */
export function isV2Settings(parsed: unknown): parsed is TimelineSettingsV2 {
  if (typeof parsed !== 'object' || parsed == null) return false
  const obj = parsed as Record<string, unknown>
  return obj.version === 2 && 'timelines' in obj && Array.isArray(obj.timelines)
}

/**
 * Advanced Query でないタイムラインから customQuery を外す。
 * 通常モードでは個別フィルタが正で、残った customQuery は重い取得経路に入る。
 */
export function cleanupNonAdvancedCustomQuery(
  settings: TimelineSettingsV2,
): TimelineSettingsV2 {
  let changed = false
  const timelines = settings.timelines.map((timeline) => {
    if (!timeline.advancedQuery && timeline.customQuery != null) {
      changed = true
      const { customQuery: _, ...rest } = timeline
      return rest
    }
    return timeline
  })
  return changed ? { ...settings, timelines } : settings
}
