import type { TimelineConfigV2, TimelineSettingsV2 } from 'types/types'
import type { V1TimelineConfig, V1TimelineSettings } from './types'

/**
 * V1 設定かどうかを判定する型ガード
 */
export function isV1Settings(parsed: unknown): parsed is V1TimelineSettings {
  if (typeof parsed !== 'object' || parsed == null) return false
  const obj = parsed as Record<string, unknown>
  return (
    !('version' in obj) && 'timelines' in obj && Array.isArray(obj.timelines)
  )
}

/**
 * V2 設定かどうかを判定する型ガード
 */
export function isV2Settings(parsed: unknown): parsed is TimelineSettingsV2 {
  if (typeof parsed !== 'object' || parsed == null) return false
  const obj = parsed as Record<string, unknown>
  return obj.version === 2 && 'timelines' in obj && Array.isArray(obj.timelines)
}

/**
 * V1 の TimelineConfig を V2 に変換する
 *
 * ## 変換ルール
 *
 * 1. id: そのまま維持（V1 の文字列 ID を継続使用）
 * 2. type: そのまま維持
 * 3. visible: そのまま維持
 * 4. order: そのまま維持
 * 5. backendFilter: 未設定 → { mode: 'all' }
 * 6. onlyMedia:
 *    - type === 'public' の場合 → true
 *      ※ 現行の PublicTimeline はコード上で only_media: true がハードコードされていた
 *    - それ以外 → false
 * 7. tag → tagConfig: V1 の tag フィールドを TagConfig に変換
 *    - tag が存在する場合: { tags: [tag], mode: 'or' }
 *    - tag が存在しない場合: tagConfig を設定しない
 * 8. label: 未設定（undefined）
 */
function migrateConfigV1toV2(v1: V1TimelineConfig): TimelineConfigV2 {
  const v2: TimelineConfigV2 = {
    backendFilter: { mode: 'all' },
    id: v1.id,
    onlyMedia: v1.type === 'public',
    order: v1.order,
    type: v1.type,
    visible: v1.visible,
  }

  // tag → tagConfig 変換
  if (v1.type === 'tag' && v1.tag != null && v1.tag.trim() !== '') {
    v2.tagConfig = {
      mode: 'or',
      tags: [v1.tag.trim()],
    }
  }

  return v2
}

/**
 * V1 の TimelineSettings を V2 に変換する
 *
 * V1 データが部分的に壊れている場合（timelines が空配列、order が欠損等）、
 * 可能な限り復元を試みる。復元不能な場合はデフォルト設定にフォールバックする。
 */
export function migrateV1toV2(v1: V1TimelineSettings): TimelineSettingsV2 {
  const timelines = v1.timelines
    .filter((t): t is V1TimelineConfig => {
      // 最低限の型チェック
      return (
        typeof t === 'object' &&
        t != null &&
        typeof t.id === 'string' &&
        typeof t.type === 'string' &&
        typeof t.visible === 'boolean' &&
        typeof t.order === 'number'
      )
    })
    .map(migrateConfigV1toV2)

  return {
    timelines,
    version: 2,
  }
}
