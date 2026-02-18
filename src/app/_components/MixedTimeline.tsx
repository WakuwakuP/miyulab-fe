'use client'

import { Notification } from 'app/_parts/Notification'
import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import { TimelineStreamIcon } from 'app/_parts/TimelineIcon'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEventHandler,
} from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type {
  NotificationAddAppIndex,
  StatusAddAppIndex,
  TimelineConfigV2,
} from 'types/types'
import { CENTER_INDEX } from 'util/environment'
import { useTimelineData } from 'util/hooks/useTimelineData'
import { getDefaultTimelineName } from 'util/timelineDisplayName'

/**
 * 混合タイムラインコンポーネント
 *
 * statuses と notifications の両方を含むクエリ結果を表示する。
 * 各アイテムの `_type` フィールドに基づいて Status / Notification を描き分ける。
 */
export const MixedTimeline = ({
  config,
  headerOffset,
}: {
  config: TimelineConfigV2
  headerOffset?: string
}) => {
  const { data: timeline, averageDuration } = useTimelineData(config)
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [enableScrollToTop, setEnableScrollToTop] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)

  const displayName = useMemo(() => {
    if (config.label) return config.label
    return getDefaultTimelineName(config)
  }, [config])

  const internalIndex = useMemo(() => {
    return CENTER_INDEX - timeline.length
  }, [timeline.length])

  const onWheel = useCallback<WheelEventHandler<HTMLDivElement>>((e) => {
    if (e.deltaY > 0) {
      setEnableScrollToTop(false)
    }
  }, [])

  const atTopStateChange = useCallback((state: boolean) => {
    if (state) {
      setEnableScrollToTop(true)
    }
  }, [])

  const scrollToTop = useCallback(() => {
    scrollerRef.current?.scrollToIndex({
      behavior: 'smooth',
      index: 0,
    })
  }, [])

  useEffect(() => {
    void timeline.length
    if (enableScrollToTop) {
      timer.current = setTimeout(() => {
        scrollToTop()
      }, 50)
    }
    return () => {
      if (timer.current != null) clearTimeout(timer.current)
    }
  }, [enableScrollToTop, timeline.length, scrollToTop])

  return (
    <Panel
      averageDuration={averageDuration}
      className="relative"
      headerOffset={headerOffset}
      name={displayName}
      onClickHeader={() => scrollToTop()}
    >
      {enableScrollToTop && <TimelineStreamIcon />}
      <Virtuoso
        atTopStateChange={atTopStateChange}
        atTopThreshold={20}
        data={timeline}
        firstItemIndex={internalIndex}
        isScrolling={setIsScrolling}
        itemContent={(_, item) => {
          // _type フィールドで Status と Notification を判別
          if ('_type' in item && item._type === 'notification') {
            return (
              <Notification
                key={item.id}
                notification={item as NotificationAddAppIndex}
                scrolling={enableScrollToTop ? false : isScrolling}
              />
            )
          }
          return (
            <Status
              key={item.id}
              scrolling={enableScrollToTop ? false : isScrolling}
              status={item as StatusAddAppIndex}
            />
          )
        }}
        onWheel={onWheel}
        ref={scrollerRef}
        totalCount={timeline.length}
      />
    </Panel>
  )
}
