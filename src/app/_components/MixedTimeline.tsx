'use client'

import { Notification } from 'app/_parts/Notification'
import { Status } from 'app/_parts/Status'
import { useMemo } from 'react'
import type { TimelineViewModel } from 'types/timelineViewModel'
import type {
  NotificationAddAppIndex,
  StatusAddAppIndex,
  TimelineConfigV2,
} from 'types/types'
import { useOtherQueueProgress } from 'util/hooks/useOtherQueueProgress'
import { useTimelineData } from 'util/hooks/useTimelineData'
import { getDefaultTimelineName } from 'util/timelineDisplayName'
import { TimelinePresenter } from './TimelinePresenter'

/**
 * 混合タイムラインコンポーネント (Container)
 *
 * statuses と notifications の両方を含むクエリ結果を表示する。
 * 各アイテムの `type` フィールドに基づいて Status / Notification を描き分ける。
 */
export const MixedTimeline = ({
  config,
  headerOffset,
}: {
  config: TimelineConfigV2
  headerOffset?: string
}) => {
  const { data, hasMoreOlder, isLoadingOlder, loadOlder, queryDuration } =
    useTimelineData(config)
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
      renderItem={(item, scrolling) => {
        if ('type' in item) {
          return (
            <Notification
              key={item.id}
              notification={item as NotificationAddAppIndex}
              scrolling={scrolling}
            />
          )
        }
        return (
          <Status
            key={item.id}
            scrolling={scrolling}
            status={item as StatusAddAppIndex}
          />
        )
      }}
      viewModel={viewModel}
    />
  )
}
