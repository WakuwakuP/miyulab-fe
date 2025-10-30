'use client'
import {
  type WheelEventHandler,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { type Entity } from 'megalodon'
import {
  Virtuoso,
  type VirtuosoHandle,
} from 'react-virtuoso'

import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import { TimelineStreamIcon } from 'app/_parts/TimelineIcon'
import { type StatusAddAppIndex } from 'types/types'
import { ArrayLengthControl } from 'util/ArrayLengthControl'
import { CENTER_INDEX } from 'util/environment'
import { GetClient } from 'util/GetClient'
import { AppsContext } from 'util/provider/AppsProvider'
import { SetTagsContext } from 'util/provider/ResourceProvider'
import { usePageLifecycle } from 'util/usePageLifecycle'

export const PublicTimeline = () => {
  const refFirstRef = useRef(true)
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<
    typeof setTimeout
  > | null>(null)
  const apps = useContext(AppsContext)
  const setTags = useContext(SetTagsContext)
  const isVisible = usePageLifecycle()
  const streamRef = useRef<Awaited<
    ReturnType<
      ReturnType<typeof GetClient>['publicStreaming']
    >
  > | null>(null)

  const [timeline, setTimeline] = useState<
    StatusAddAppIndex[]
  >([])

  const [enableScrollToTop, setEnableScrollToTop] =
    useState(true)
  const [isScrolling, setIsScrolling] = useState(false)

  const internalIndex = useMemo(() => {
    return CENTER_INDEX - timeline.length
  }, [timeline.length])

  useEffect(() => {
    if (
      process.env.NODE_ENV === 'development' &&
      refFirstRef.current
    ) {
      refFirstRef.current = false
      return
    }
    if (apps.length <= 0) return
    const client = GetClient(apps[0])

    client
      .getPublicTimeline({ limit: 40, only_media: true })
      .then((res) => {
        setTimeline(
          res.data.map((status) => ({
            ...status,
            appIndex: 0,
          }))
        )
      })
    client.publicStreaming().then((stream) => {
      // Store stream reference for lifecycle management
      streamRef.current = stream

      stream.on('update', (status: Entity.Status) => {
        setTags((prev) =>
          Array.from(
            new Set([
              ...prev,
              ...status.tags.map((tag) => tag.name),
            ])
          )
        )
        if (status.media_attachments.length > 0) {
          setTimeline((prev) =>
            ArrayLengthControl([
              { ...status, appIndex: 0 },
              ...prev,
            ])
          )
        }
      })
      stream.on('connect', () => {
        // eslint-disable-next-line no-console
        console.info('connected publicStreaming')
      })

      stream.on('delete', (id: string) => {
        setTimeline((prev) =>
          prev.filter((status) => status.id !== id)
        )
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

  // Handle page visibility changes using Page Lifecycle API
  useEffect(() => {
    if (streamRef.current == null) return

    if (isVisible) {
      // Resume stream when page becomes visible
      streamRef.current.start()
      // eslint-disable-next-line no-console
      console.info(
        'Resumed public WebSocket stream (page visible)'
      )
    } else {
      // Pause stream when page becomes hidden
      streamRef.current.stop()
      // eslint-disable-next-line no-console
      console.info(
        'Paused public WebSocket stream (page hidden)'
      )
    }
  }, [isVisible])

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
      name="Public"
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
