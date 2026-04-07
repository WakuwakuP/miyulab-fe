'use client'

import { Notification } from 'app/_parts/Notification'
import { useMemo } from 'react'
import type { TimelineViewModel } from 'types/timelineViewModel'
import type { NotificationAddAppIndex, TimelineConfigV2 } from 'types/types'
import { useOtherQueueProgress } from 'util/hooks/useOtherQueueProgress'
import { useTimelineData } from 'util/hooks/useTimelineData'
import { TimelinePresenter } from './TimelinePresenter'

/**
 * 通知タイムラインコンポーネント (Container)
 *
 * 通知専用のタイムライン。データを NotificationAddAppIndex にフィルタし、
 * TimelinePresenter に委譲する。
 */
export const NotificationTimeline = ({
  config,
  headerOffset,
}: {
  config: TimelineConfigV2
  headerOffset?: string
}) => {
  const {
    data: rawData,
    hasMoreOlder,
    isLoadingOlder,
    loadOlder,
    queryDuration,
  } = useTimelineData(config)
  const { initializing } = useOtherQueueProgress()

  const notifications = useMemo(
    () =>
      rawData.filter((item): item is NotificationAddAppIndex => 'type' in item),
    [rawData],
  )

  const viewModel: TimelineViewModel = {
    configId: config.id,
    data: notifications,
    displayName: config.label ?? 'Notification',
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
        <Notification
          key={item.id}
          notification={item as NotificationAddAppIndex}
          scrolling={scrolling}
        />
      )}
      viewModel={viewModel}
    />
  )
}
