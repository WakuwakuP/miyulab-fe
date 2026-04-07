'use client'

import type { TimelineConfigV2 } from 'types/types'
import type { UseTimelineDataSourceOptions } from 'util/hooks/useTimelineDataSource'
import { useTimelineList } from 'util/hooks/useTimelineList'

export type { TimelineViewModel } from 'types/timelineViewModel'

/** useTimelineData の戻り値型（TimelineViewModel のデータ部分） */
export type TimelineDataResult = Pick<
  import('types/timelineViewModel').TimelineViewModel,
  'data' | 'hasMoreOlder' | 'isLoadingOlder' | 'loadOlder' | 'queryDuration'
>

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
): TimelineDataResult {
  const { hasMoreOlder, isLoadingOlder, items, loadOlder, queryDuration } =
    useTimelineList(config, options)

  return {
    data: items,
    hasMoreOlder,
    isLoadingOlder,
    loadOlder,
    queryDuration,
  }
}
