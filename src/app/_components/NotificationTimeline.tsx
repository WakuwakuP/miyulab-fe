'use client'

import { Notification } from 'app/_parts/Notification'
import { Panel } from 'app/_parts/Panel'
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
import type { NotificationAddAppIndex, TimelineConfigV2 } from 'types/types'
import { CENTER_INDEX } from 'util/environment'
import { useTimelineData } from 'util/hooks/useTimelineData'

export const NotificationTimeline = ({
  config,
  headerOffset,
}: {
  config: TimelineConfigV2
  headerOffset?: string
}) => {
  const { data: rawData, averageDuration, loadMore } = useTimelineData(config)
  // Runtime type guard: filter out any non-notification items that may slip through
  const notifications = useMemo(
    () =>
      rawData.filter((item): item is NotificationAddAppIndex => 'type' in item),
    [rawData],
  )
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [enableScrollToTop, setEnableScrollToTop] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)

  // loadMore() で末尾に追加されたアイテム数を追跡し、
  // firstItemIndex を安定させる（Virtuoso が誤ってプリペンドと解釈しないようにする）
  const [bottomExpansion, setBottomExpansion] = useState(0)
  const prevLengthRef = useRef(notifications.length)

  useEffect(() => {
    const diff = notifications.length - prevLengthRef.current
    if (diff > 0 && !enableScrollToTop) {
      setBottomExpansion((prev) => prev + diff)
    }
    prevLengthRef.current = notifications.length
  }, [notifications.length, enableScrollToTop])

  const internalIndex = useMemo(() => {
    return CENTER_INDEX - notifications.length + bottomExpansion
  }, [notifications.length, bottomExpansion])

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
    if (scrollerRef.current != null) {
      scrollerRef.current.scrollToIndex({
        behavior: 'smooth',
        index: 0,
      })
    }
  }, [])

  useEffect(() => {
    void notifications.length // 明示的に依存があることを示す
    if (enableScrollToTop) {
      timer.current = setTimeout(() => {
        scrollToTop()
      }, 50)
    }
    return () => {
      if (timer.current == null) return
      clearTimeout(timer.current)
    }
  }, [enableScrollToTop, scrollToTop, notifications.length])

  return (
    <Panel
      averageDuration={averageDuration}
      className="relative"
      headerOffset={headerOffset}
      name={config.label ?? 'Notification'}
      onClickHeader={() => {
        scrollToTop()
      }}
    >
      {enableScrollToTop && <TimelineStreamIcon />}
      <Virtuoso
        atTopStateChange={atTopStateChange}
        atTopThreshold={20}
        data={notifications}
        endReached={loadMore}
        firstItemIndex={internalIndex}
        isScrolling={setIsScrolling}
        itemContent={(_, notification) => (
          <Notification
            key={notification.id}
            notification={notification}
            scrolling={enableScrollToTop ? false : isScrolling}
          />
        )}
        onWheel={onWheel}
        ref={scrollerRef}
        totalCount={notifications.length}
      />
    </Panel>
  )
}
