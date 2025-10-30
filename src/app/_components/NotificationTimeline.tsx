'use client'

import { Notification } from 'app/_parts/Notification'
import { Panel } from 'app/_parts/Panel'
import { TimelineStreamIcon } from 'app/_parts/TimelineIcon'
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEventHandler,
} from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { CENTER_INDEX } from 'util/environment'
import { NotificationsContext } from 'util/provider/HomeTimelineProvider'

export const NotificationTimeline = () => {
  const notifications = useContext(NotificationsContext)
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [enableScrollToTop, setEnableScrollToTop] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)

  const internalIndex = useMemo(() => {
    return CENTER_INDEX - notifications.length
  }, [notifications.length])

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
      className="relative"
      name="Notification"
      onClickHeader={() => {
        scrollToTop()
      }}
    >
      {enableScrollToTop && <TimelineStreamIcon />}
      <Virtuoso
        atTopStateChange={atTopStateChange}
        atTopThreshold={20}
        data={notifications}
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
