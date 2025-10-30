'use client'
import {
  type WheelEventHandler,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
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

export const LocalTimeline = () => {
  const refFirstRef = useRef(true)
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<
    typeof setTimeout
  > | null>(null)
  const apps = useContext(AppsContext)
  const setTags = useContext(SetTagsContext)

  const [timeline, setTimeline] = useState<
    StatusAddAppIndex[]
  >([])

  const [enableScrollToTop, setEnableScrollToTop] =
    useState(true)
  const [isScrolling, setIsScrolling] = useState(false)

  const internalIndex = useMemo(() => {
    return CENTER_INDEX - timeline.length
  }, [timeline.length])

  const onStreamUpdate = useEffectEvent((status: Entity.Status) => {
    const statusesForHashtag = status.tags.map(
      (tag) => tag.name
    )
    setTags((prev) => [...prev, ...statusesForHashtag])

    setTimeline((prev) =>
      ArrayLengthControl([
        { ...status, appIndex: 0 },
        ...prev,
      ])
    )
  })

  const onStreamDelete = useEffectEvent((id: string) => {
    setTimeline((prev) =>
      prev.filter((status) => status.id !== id)
    )
  })

  const onStreamError = useEffectEvent((stream: any) => (err: Error) => {
    console.error(err)

    stream.stop()
    const timeout = setTimeout(() => {
      stream.start()
      // eslint-disable-next-line no-console
      console.info('reconnected localSocket')
      clearTimeout(timeout)
    }, 1000)
  })

  useEffect(() => {
    if (apps.length <= 0) return

    const client = GetClient(apps[0])

    if (refFirstRef.current) {
      refFirstRef.current = false

      client
        .getLocalTimeline({ limit: 40 })
        .then((res) => {
          const statuses = res.data.map((status) => ({
            ...status,
            appIndex: 0,
          }))
          setTimeline(statuses)
        })
        .catch((error) => {
          console.error(
            'Failed to fetch local timeline:',
            error
          )
        })
    }

    client.localStreaming().then((stream) => {
      stream.on('update', onStreamUpdate)
      stream.on('connect', () => {
        // eslint-disable-next-line no-console
        console.info('connected localStreaming')
      })

      stream.on('delete', onStreamDelete)

      stream.on('error', onStreamError(stream))
    })
  }, [apps])

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

  const scrollToTopIfNeeded = useEffectEvent(() => {
    if (enableScrollToTop) {
      if (!isScrolling) {
        scrollerRef.current?.scrollToIndex({
          index: 0,
          behavior: 'smooth',
        })
      }
    }
  })

  // 最新の投稿が追加されたときにスクロールする
  useEffect(() => {
    scrollToTopIfNeeded()
  }, [timeline, enableScrollToTop, isScrolling])

  useEffect(() => {
    if (!isScrolling) return

    timer.current = setTimeout(() => {
      setIsScrolling(false)
    }, 1000)

    return () => {
      if (timer.current != null) {
        clearTimeout(timer.current)
      }
    }
  }, [isScrolling])

  return (
    <Panel
      name="Local"
      className="relative"
    >
      <div className="absolute right-2 top-2 z-10">
        <TimelineStreamIcon />
      </div>
      <div
        onWheel={onWheel}
        className="h-full"
      >
        <Virtuoso
          ref={scrollerRef}
          data={timeline}
          initialTopMostItemIndex={timeline.length - 1}
          firstItemIndex={internalIndex}
          atTopStateChange={atTopStateChange}
          isScrolling={(scrolling) => {
            setIsScrolling(scrolling)
          }}
          itemContent={(index, status) => (
            <Status
              key={status.id}
              status={status}
            />
          )}
        />
      </div>
    </Panel>
  )
}
