'use client'

import { Notification } from 'app/_parts/Notification'
import { Panel } from 'app/_parts/Panel'
import { TimelineStreamIcon } from 'app/_parts/TimelineIcon'
import { TimelineLoading } from 'app/_parts/TimelineLoading'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEventHandler,
} from 'react'
import { CgSpinner } from 'react-icons/cg'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type { NotificationAddAppIndex, TimelineConfigV2 } from 'types/types'
import { CENTER_INDEX } from 'util/environment'
import { useOtherQueueProgress } from 'util/hooks/useOtherQueueProgress'
import { useTimelineData } from 'util/hooks/useTimelineData'

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

  // loadOlder で末尾に追加されたアイテム数を同期的に追跡し、
  // firstItemIndex を安定させる（Virtuoso が誤ってプリペンドと解釈しないようにする）
  const bottomExpansionRef = useRef(0)
  const prevLengthRef = useRef(notifications.length)

  // config 変更時に bottomExpansion をリセット
  const configId = config.id
  useEffect(() => {
    void configId
    bottomExpansionRef.current = 0
  }, [configId])

  const currentLength = notifications.length
  if (currentLength !== prevLengthRef.current) {
    const diff = currentLength - prevLengthRef.current
    if (diff > 0 && !enableScrollToTop) {
      bottomExpansionRef.current += diff
    }
    prevLengthRef.current = currentLength
  }

  const internalIndex =
    CENTER_INDEX - currentLength + bottomExpansionRef.current

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
    void notifications.length
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

  const virtuosoComponents = useMemo(
    () => ({
      Footer: () =>
        isLoadingOlder ? (
          <div className="flex items-center justify-center py-4">
            <CgSpinner className="animate-spin text-gray-400" size={24} />
          </div>
        ) : null,
    }),
    [isLoadingOlder],
  )

  return (
    <Panel
      className="relative"
      headerOffset={headerOffset}
      name={config.label ?? 'Notification'}
      onClickHeader={() => {
        scrollToTop()
      }}
      queryDuration={queryDuration}
    >
      {notifications.length === 0 && initializing ? (
        <TimelineLoading />
      ) : (
        <>
          {enableScrollToTop && <TimelineStreamIcon />}
          <Virtuoso
            atTopStateChange={atTopStateChange}
            atTopThreshold={20}
            components={virtuosoComponents}
            data={notifications}
            endReached={hasMoreOlder ? loadOlder : undefined}
            firstItemIndex={internalIndex}
            increaseViewportBy={200}
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
        </>
      )}
    </Panel>
  )
}
