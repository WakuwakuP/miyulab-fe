'use client'

import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
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
import { HomeTimelineContext } from 'util/provider/HomeTimelineProvider'

export const HomeTimeline = () => {
  const timeline = useContext(HomeTimelineContext)
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [enableScrollToTop, setEnableScrollToTop] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)

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
    if (scrollerRef.current != null) {
      scrollerRef.current.scrollToIndex({
        behavior: 'smooth',
        index: 0,
      })
    }
  }, [])

  useEffect(() => {
    void timeline.length // 明示的に依存があることを示す
    if (enableScrollToTop) {
      timer.current = setTimeout(() => {
        scrollToTop()
      }, 50)
    }
    return () => {
      if (timer.current == null) return
      clearTimeout(timer.current)
    }
  }, [enableScrollToTop, timeline.length, scrollToTop])

  return (
    <Panel
      className="relative"
      name="Home"
      onClickHeader={() => {
        scrollToTop()
      }}
    >
      {enableScrollToTop && <TimelineStreamIcon />}
      <Virtuoso
        atTopStateChange={atTopStateChange}
        atTopThreshold={20}
        data={timeline}
        firstItemIndex={internalIndex}
        isScrolling={setIsScrolling}
        itemContent={(_, status) => (
          <Status
            key={status.id}
            scrolling={enableScrollToTop ? false : isScrolling}
            status={status}
          />
        )}
        onWheel={onWheel}
        ref={scrollerRef}
        totalCount={timeline.length}
      />
    </Panel>
  )
}
