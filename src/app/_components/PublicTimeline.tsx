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

import { Entity } from 'megalodon'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'

import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import { TimelineStreamIcon } from 'app/_parts/TimelineIcon'
import { ArrayLengthControl } from 'util/ArrayLengthControl'
import { CENTER_INDEX } from 'util/environment'
import { GetClient } from 'util/GetClient'
import { TokenContext } from 'util/provider/AppProvider'
import { SetTagsContext } from 'util/provider/ResourceProvider'

export const PublicTimeline = () => {
  const refFirstRef = useRef(true)
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<
    typeof setTimeout
  > | null>(null)
  const token = useContext(TokenContext)
  const setTags = useContext(SetTagsContext)

  const [timeline, setTimeline] = useState<Entity.Status[]>(
    []
  )

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
    if (token == null) return
    const client = GetClient(token?.access_token)

    client
      .getPublicTimeline({ limit: 40, only_media: true })
      .then((res) => {
        setTimeline(res.data)
      })
    client.publicStreaming().then((stream) => {
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
            ArrayLengthControl([status, ...prev])
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
  }, [setTags, token])

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
