'use client'

import { NotificationTimeline } from 'app/_components/NotificationTimeline'
import { UnifiedTimeline } from 'app/_components/UnifiedTimeline'
import type { TimelineConfigV2 } from 'types/types'

export const DynamicTimeline = ({ config }: { config: TimelineConfigV2 }) => {
  if (!config.visible) {
    return null
  }

  // notification は専用コンポーネントを維持（表示形式が大きく異なるため）
  if (config.type === 'notification') {
    return <NotificationTimeline config={config} />
  }

  return <UnifiedTimeline config={config} />
}
