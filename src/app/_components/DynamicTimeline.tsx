'use client'

import { NotificationTimeline } from 'app/_components/NotificationTimeline'
import { UnifiedTimeline } from 'app/_components/UnifiedTimeline'
import type { TimelineConfigV2 } from 'types/types'
import { isMixedQuery, isNotificationQuery } from 'util/queryBuilder'
import { MixedTimeline } from './MixedTimeline'

export const DynamicTimeline = ({ config }: { config: TimelineConfigV2 }) => {
  if (!config.visible) {
    return null
  }

  const query = config.customQuery ?? ''

  // 混合クエリ: statuses と notifications の両方を参照する場合は MixedTimeline を使用
  if (isMixedQuery(query)) {
    return <MixedTimeline config={config} />
  }

  // notification タイプ、または Advanced Query で n. テーブルを参照している場合は
  // NotificationTimeline を使用（表示形式が大きく異なるため）
  if (config.type === 'notification' || isNotificationQuery(query)) {
    return <NotificationTimeline config={config} />
  }

  return <UnifiedTimeline config={config} />
}
