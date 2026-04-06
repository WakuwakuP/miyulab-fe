'use client'

import type {
  NotificationAddAppIndex,
  StatusAddAppIndex,
  TimelineConfigV2,
} from 'types/types'
import type { UseTimelineDataSourceOptions } from 'util/hooks/useTimelineDataSource'
import { useTimelineList } from 'util/hooks/useTimelineList'

/**
 * `TimelineConfigV2` に基づき、インメモリリスト管理 + カーソルベースページネーションで
 * データを取得するファサード。
 *
 * 内部では `useTimelineList` を使用し、データ取得とリスト管理を分離している。
 *
 * @param config — タイムライン種別・フィルタ・カスタム SQL 等の設定
 * @param options — オプション設定 (disabled, onFirstFetch)
 */
export function useTimelineData(
  config: TimelineConfigV2,
  options?: UseTimelineDataSourceOptions,
): {
  data: (NotificationAddAppIndex | StatusAddAppIndex)[]
  hasMore: boolean
  isLoadingMore: boolean
  loadOlder: () => Promise<void>
  queryDuration: number | null
} {
  const { hasMore, isLoadingMore, items, loadOlder, queryDuration } =
    useTimelineList(config, options)

  return {
    data: items,
    hasMore,
    isLoadingMore,
    loadOlder,
    queryDuration,
  }
}
