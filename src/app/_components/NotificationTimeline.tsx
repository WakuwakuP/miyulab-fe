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
import type { TimelineConfigV2 } from 'types/types'
import { CENTER_INDEX } from 'util/environment'
import { useNotifications } from 'util/hooks/useNotifications'
import { AppsContext } from 'util/provider/AppsProvider'
import {
  normalizeBackendFilter,
  resolveBackendUrls,
} from 'util/timelineConfigValidator'

export const NotificationTimeline = ({
  config,
}: {
  config: TimelineConfigV2
}) => {
  const apps = useContext(AppsContext)
  const allNotifications = useNotifications()
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [enableScrollToTop, setEnableScrollToTop] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)

  // backendFilter に基づいてフィルタ
  const targetBackendUrls = useMemo(() => {
    const filter = normalizeBackendFilter(config.backendFilter, apps)
    return resolveBackendUrls(filter, apps)
  }, [config.backendFilter, apps])

  const notifications = useMemo(
    () =>
      allNotifications.filter((n) =>
        targetBackendUrls.includes(apps[n.appIndex]?.backendUrl),
      ),
    [allNotifications, targetBackendUrls, apps],
  )

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
