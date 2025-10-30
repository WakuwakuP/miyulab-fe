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

export const PublicTimeline = () => {
  const refFirstRef = useRef(true)
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const apps = useContext(AppsContext)
  const setTags = useContext(SetTagsContext)

  const [timeline, setTimeline] = useState<StatusAddAppIndex[]>([])

  const [enableScrollToTop, setEnableScrollToTop] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)

  const internalIndex = useMemo(() => {
    return CENTER_INDEX - timeline.length
  }, [timeline.length])

  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && refFirstRef.current) {
      refFirstRef.current = false
      return
    }
    if (apps.length <= 0) return
    const client = GetClient(apps[0])

    client.getPublicTimeline({ limit: 40, only_media: true }).then((res) => {
      setTimeline(
        res.data.map((status) => ({
          ...status,
          appIndex: 0,
        })),
      )
    })
    client.publicStreaming().then((stream) => {
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
        console.info('connected publicStreaming')
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
          console.info('reconnected publicSocket')
          clearTimeout(timeout)
        }, 1000)
      })
    })
  }, [apps, setTags])

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
  }, [enableScrollToTop, scrollToTop])

  return (
    <Panel
      className="relative"
      name="Public"
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
