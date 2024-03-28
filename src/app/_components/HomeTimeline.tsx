'use client'

import {
  WheelEventHandler,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'

import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import { TimelineStreamIcon } from 'app/_parts/TimelineIcon'
import { CENTER_INDEX } from 'util/environment'
import { HomeTimelineContext } from 'util/provider/HomeTimelineProvider'

export const HomeTimeline = () => {
  const timeline = useContext(HomeTimelineContext)
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<
    typeof setTimeout
  > | null>(null)

  const [enableScrollToTop, setEnableScrollToTop] =
    useState(true)
  const [isScrolling, setIsScrolling] = useState(false)

  const internalIndex = useMemo(() => {
    return CENTER_INDEX - timeline.length
  }, [timeline.length])

  const onWheel = useCallback<
    WheelEventHandler<HTMLDivElement>
  >((e) => {
    if (e.deltaY > 0) {
      setEnableScrollToTop(false)
    }
  }, [])

  const atTopStateChange = useCallback((state: boolean) => {
    if (state) {
      setEnableScrollToTop(true)
    }
  }, [])

  useEffect(() => {
    if (enableScrollToTop) {
      timer.current = setTimeout(() => {
        scrollToTop()
      }, 50)
    }
    return () => {
      if (timer.current == null) return
      clearTimeout(timer.current)
    }
  }, [enableScrollToTop, timeline.length])

  const scrollToTop = () => {
    if (scrollerRef.current != null) {
      scrollerRef.current.scrollToIndex({
        index: 0,
        behavior: 'smooth',
      })
    }
  }

  return (
    <Panel
      name="Home"
      onClickHeader={() => {
        scrollToTop()
      }}
      className="relative"
    >
      {enableScrollToTop && <TimelineStreamIcon />}
      <Virtuoso
        data={timeline}
        ref={scrollerRef}
        firstItemIndex={internalIndex}
        totalCount={timeline.length}
        atTopStateChange={atTopStateChange}
        atTopThreshold={20}
        isScrolling={setIsScrolling}
        onWheel={onWheel}
        itemContent={(_, status) => (
          <Status
            key={status.id}
            status={status}
            scrolling={
              enableScrollToTop ? false : isScrolling
            }
          />
        )}
      />
    </Panel>
  )
}
