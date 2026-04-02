'use client'

import type {
  NotificationAddAppIndex,
  StatusAddAppIndex,
  TimelineConfigV2,
} from 'types/types'
import { useGraphTimeline } from 'util/hooks/useGraphTimeline'

/**
 * `TimelineConfigV2` に基づき、グラフ実行エンジンでデータを取得するファサード。
 *
 * 内部では `useGraphTimeline` を使用し、QueryPlanV2 グラフを Worker 内で実行する。
 * `config.queryPlan` があればそのまま使用、なければ `configToQueryPlanV2` で自動生成。
 *
 * @param config — タイムライン種別・フィルタ・カスタム SQL 等の設定
 * @returns `{ data, queryDuration, loadMore }`
 * @see {@link useGraphTimeline}
 */
export function useTimelineData(config: TimelineConfigV2): {
  data: (NotificationAddAppIndex | StatusAddAppIndex)[]
  queryDuration: number | null
  loadMore: () => void
} {
  return useGraphTimeline(config)
}
