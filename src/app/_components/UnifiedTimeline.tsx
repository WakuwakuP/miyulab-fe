'use client'

import { Status } from 'app/_parts/Status'
import { useMemo } from 'react'
import type { TimelineViewModel } from 'types/timelineViewModel'
import type { StatusAddAppIndex, TimelineConfigV2 } from 'types/types'
import { useOtherQueueProgress } from 'util/hooks/useOtherQueueProgress'
import { useTimelineData } from 'util/hooks/useTimelineData'
import { getDefaultTimelineName } from 'util/timelineDisplayName'
import { TimelinePresenter } from './TimelinePresenter'

/**
 * 統合タイムラインコンポーネント (Container)
 *
 * TimelineConfigV2 を受け取り、TimelineViewModel を組み立てて
 * TimelinePresenter に委譲する。行の描画は Status のみ。
 */
export const UnifiedTimeline = ({
  config,
  headerOffset,
}: {
  config: TimelineConfigV2
  headerOffset?: string
}) => {
  const { data, hasMoreOlder, isLoadingOlder, loadOlder, queryDuration } =
    useTimelineData(config) as {
      data: StatusAddAppIndex[]
      hasMoreOlder: boolean
      isLoadingOlder: boolean
      loadOlder: () => Promise<void>
      queryDuration: number | null
    }
  const { initializing } = useOtherQueueProgress()

  const displayName = useMemo(() => {
    if (config.label) return config.label
    return getDefaultTimelineName(config)
  }, [config])

  const viewModel: TimelineViewModel = {
    configId: config.id,
    data,
    displayName,
    hasMoreOlder,
    initializing,
    isLoadingOlder,
    loadOlder,
    queryDuration,
  }

  return (
    <TimelinePresenter
      headerOffset={headerOffset}
      renderItem={(item, scrolling) => (
        <Status
          key={item.id}
          scrolling={scrolling}
          status={item as StatusAddAppIndex}
        />
      )}
      viewModel={viewModel}
    />
  )
}
