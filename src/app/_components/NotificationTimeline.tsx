'use client'

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'

import { Notification } from 'app/_parts/Notification'
import { Panel } from 'app/_parts/Panel'
import { CENTER_INDEX } from 'util/environment'
import { NotificationsContext } from 'util/provider/HomeTimelineProvider'

export const NotificationTimeline = () => {
  const notifications = useContext(NotificationsContext)
  const scrollerRef = useRef<VirtuosoHandle>(null)

  const [atTop, setAtTop] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)

  const internalIndex = useMemo(() => {
    return CENTER_INDEX - notifications.length
  }, [notifications.length])

  const atTopStateChange = useCallback((state: boolean) => {
    if (state) {
      setAtTop(true)
    }
    const timer = setTimeout(() => {
      setAtTop(state)
    }, 400)
    return () => {
      clearTimeout(timer)
    }
  }, [])

  const scrollToTop = useCallback(() => {
    if (scrollerRef.current != null) {
      scrollerRef.current.scrollToIndex({
        index: 0,
        behavior: 'smooth',
      })
    }
  }, [])

  useEffect(() => {
    if (!atTop) return
    const timer = setTimeout(() => {
      scrollToTop()
    }, 50)
    return () => {
      clearTimeout(timer)
    }
  }, [atTop, notifications.length, scrollToTop])

  return (
    <Panel
      name="Notification"
      onClickHeader={() => {
        scrollToTop()
      }}
    >
      <Virtuoso
        data={notifications}
        ref={scrollerRef}
        firstItemIndex={internalIndex}
        totalCount={notifications.length}
        atTopStateChange={atTopStateChange}
        atTopThreshold={20}
        isScrolling={setIsScrolling}
        itemContent={(_, notification) => (
          <Notification
            key={notification.id}
            notification={notification}
            scrolling={atTop ? false : isScrolling}
          />
        )}
      />
    </Panel>
  )
}
