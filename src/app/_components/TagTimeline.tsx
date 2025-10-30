'use client'

import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import { TimelineStreamIcon } from 'app/_parts/TimelineIcon'
import type { Entity } from 'megalodon'
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
import type { StatusAddAppIndex } from 'types/types'
import { ArrayLengthControl } from 'util/ArrayLengthControl'
import { CENTER_INDEX } from 'util/environment'
import { GetClient } from 'util/GetClient'
import { AppsContext } from 'util/provider/AppsProvider'
import { SetTagsContext } from 'util/provider/ResourceProvider'

export const TagTimeline = ({ tag }: { tag: string }) => {
  const refFirstRef = useRef(true)

  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const apps = useContext(AppsContext)
  const setTags = useContext(SetTagsContext)

  const [timeline, setTimeline] = useState<StatusAddAppIndex[]>([])

  const [enableScrollToTop, setEnableScrollToTop] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)

  const [moreCount, setMoreCount] = useState(0)

  const internalIndex = useMemo(() => {
    return CENTER_INDEX - timeline.length + moreCount
  }, [timeline.length, moreCount])

  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && refFirstRef.current) {
      refFirstRef.current = false
      return
    }
    if (apps.length <= 0) return
    const client = GetClient(apps[0])

    client.getTagTimeline(tag, { limit: 40 }).then((res) => {
      setTimeline(
        res.data.map((status) => ({
          ...status,
          appIndex: 0,
        })),
      )
    })

    client.tagStreaming(tag).then((stream) => {
      stream.on('update', (status: Entity.Status) => {
        setTags((prev) =>
          Array.from(new Set([...prev, ...status.tags.map((tag) => tag.name)])),
        )
        if (status.media_attachments.length > 0) {
          setTimeline((prev) =>
            ArrayLengthControl([{ ...status, appIndex: 0 }, ...prev]),
          )
        }
      })
      stream.on('connect', () => {
        // eslint-disable-next-line no-console
        console.info('connected tagStreaming')
      })

      stream.on('delete', (id: string) => {
        setTimeline((prev) => prev.filter((status) => status.id !== id))
      })

      stream.on('error', (err: Error) => {
        console.error(err)

        stream.stop()
        const timeout = setTimeout(() => {
          stream.start()
          // eslint-disable-next-line no-console
          console.info('reconnected tagSocket')
          clearTimeout(timeout)
        }, 1000)
      })
    })
  }, [apps, setTags, tag])

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

  const moreLoad = () => {
    if (apps.length <= 0) return
    const client = GetClient(apps[0])
    client
      .getTagTimeline(tag, {
        limit: 40,
        max_id: timeline[timeline.length - 1].id,
      })
      .then((res) => {
        setMoreCount((prev) => prev + res.data.length)
        setTimeline((prev) => [
          ...prev,
          ...res.data.map((status) => ({
            ...status,
            appIndex: 0,
          })),
        ])
      })
  }

  const scrollToTop = useCallback(() => {
    if (scrollerRef.current != null) {
      scrollerRef.current.scrollToIndex({
        behavior: 'smooth',
        index: 0,
      })
    }
  }, [])

  // 最新の投稿が追加されたときにスクロールする
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
  }, [enableScrollToTop, timeline.length, scrollToTop])

  return (
    <Panel
      className="relative"
      name={`#${tag}`}
      onClickHeader={() => {
        scrollToTop()
      }}
    >
      {enableScrollToTop && <TimelineStreamIcon />}
      <Virtuoso
        atTopStateChange={atTopStateChange}
        atTopThreshold={20}
        data={timeline}
        endReached={moreLoad}
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
