import type { TimelineSettingsV2 } from 'types/types'

/**
 * V2 設定かどうかを判定する型ガード
 */
export function isV2Settings(parsed: unknown): parsed is TimelineSettingsV2 {
  if (typeof parsed !== 'object' || parsed == null) return false
  const obj = parsed as Record<string, unknown>
  return obj.version === 2 && 'timelines' in obj && Array.isArray(obj.timelines)
}
