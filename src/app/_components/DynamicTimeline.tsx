'use client'

import { NotificationTimeline } from 'app/_components/NotificationTimeline'
import { UnifiedTimeline } from 'app/_components/UnifiedTimeline'
import type { TimelineConfigV2 } from 'types/types'

/**
 * customQuery が notifications テーブル（エイリアス n）を参照しているか判定する
 */
function isNotificationQuery(config: TimelineConfigV2): boolean {
  if (!config.customQuery?.trim()) return false
  return /\bn\.\w/.test(config.customQuery)
}

export const DynamicTimeline = ({ config }: { config: TimelineConfigV2 }) => {
  if (!config.visible) {
    return null
  }

  // notification タイプ、または Advanced Query で n. テーブルを参照している場合は
  // NotificationTimeline を使用（表示形式が大きく異なるため）
  if (config.type === 'notification' || isNotificationQuery(config)) {
    return <NotificationTimeline config={config} />
  }

  return <UnifiedTimeline config={config} />
}
