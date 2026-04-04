'use client'

import { NotificationTimeline } from 'app/_components/NotificationTimeline'
import { UnifiedTimeline } from 'app/_components/UnifiedTimeline'
import type { TimelineConfigV2 } from 'types/types'
import {
  isQueryPlanV2,
  queryPlanV2ReferencedTables,
} from 'util/db/query-ir/nodes'
import { isMixedQuery, isNotificationQuery } from 'util/queryBuilder'
import { MixedTimeline } from './MixedTimeline'

export const DynamicTimeline = ({
  config,
  headerOffset,
}: {
  config: TimelineConfigV2
  headerOffset?: string
}) => {
  if (!config.visible) {
    return null
  }

  const query = config.customQuery ?? ''

  // QueryPlanV2 が posts と notifications を両方参照する場合は MixedTimeline を使用
  if (isQueryPlanV2(config.queryPlan)) {
    const tables = queryPlanV2ReferencedTables(config.queryPlan)
    if (tables.has('posts') && tables.has('notifications')) {
      return <MixedTimeline config={config} headerOffset={headerOffset} />
    }
  }

  // 混合クエリ: statuses と notifications の両方を参照する場合は MixedTimeline を使用
  if (isMixedQuery(query)) {
    return <MixedTimeline config={config} headerOffset={headerOffset} />
  }

  // notification タイプ、または Advanced Query で n. テーブルを参照している場合は
  // NotificationTimeline を使用（表示形式が大きく異なるため）
  if (config.type === 'notification' || isNotificationQuery(query)) {
    return <NotificationTimeline config={config} headerOffset={headerOffset} />
  }

  return <UnifiedTimeline config={config} headerOffset={headerOffset} />
}
