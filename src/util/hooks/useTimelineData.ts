'use client'

import type {
  NotificationAddAppIndex,
  StatusAddAppIndex,
  TimelineConfigV2,
} from 'types/types'
import {
  type UseGraphTimelineOptions,
  useGraphTimeline,
} from 'util/hooks/useGraphTimeline'

/**
 * `TimelineConfigV2` に基づき、グラフ実行エンジンでデータを取得するファサード。
 *
 * 内部では `useGraphTimeline` を使用し、QueryPlanV2 グラフを Worker 内で実行する。
 * `config.queryPlan` があればそのまま使用、なければ `configToQueryPlanV2` で自動生成。
 *
 * @param config — タイムライン種別・フィルタ・カスタム SQL 等の設定
 * @param options — オプション設定 (disabled, onFirstFetch)
 * @returns `{ data, queryDuration, loadMore, dbHasMore }`
 * @see {@link useGraphTimeline}
 */
export function useTimelineData(
  config: TimelineConfigV2,
  options?: UseGraphTimelineOptions,
): {
  data: (NotificationAddAppIndex | StatusAddAppIndex)[]
  queryDuration: number | null
  loadMore: () => void
  dbHasMore: boolean
} {
  return useGraphTimeline(config, options)
}
