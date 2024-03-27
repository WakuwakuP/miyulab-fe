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

import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import { CENTER_INDEX } from 'util/environment'
import { HomeTimelineContext } from 'util/provider/HomeTimelineProvider'

export const HomeTimeline = () => {
  const timeline = useContext(HomeTimelineContext)
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const [atTop, setAtTop] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)

  const internalIndex = useMemo(() => {
    return CENTER_INDEX - timeline.length
  }, [timeline.length])

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

  useEffect(() => {
    if (!atTop) return
    const timer = setTimeout(() => {
      scrollToTop()
    }, 50)
    return () => {
      clearTimeout(timer)
    }
  }, [atTop, timeline.length])

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
    >
      <Virtuoso
        data={timeline}
        ref={scrollerRef}
        firstItemIndex={internalIndex}
        totalCount={timeline.length}
        atTopStateChange={atTopStateChange}
        atTopThreshold={20}
        isScrolling={setIsScrolling}
        itemContent={(_, status) => (
          <Status
            key={status.id}
            status={status}
            scrolling={atTop ? false : isScrolling}
          />
        )}
      />
    </Panel>
  )
}
