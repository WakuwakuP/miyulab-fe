'use client'

import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import { TimelineStreamIcon } from 'app/_parts/TimelineIcon'
import type { Entity } from 'megalodon'
import {
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type WheelEventHandler,
} from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import {
  bulkUpsertStatuses,
  handleDeleteEvent,
  upsertStatus,
} from 'util/db/statusStore'
import { CENTER_INDEX } from 'util/environment'
import { GetClient } from 'util/GetClient'
import { useTimeline } from 'util/hooks/useTimeline'
import { AppsContext } from 'util/provider/AppsProvider'
import { SetTagsContext } from 'util/provider/ResourceProvider'

export const LocalTimeline = () => {
  const refFirstRef = useRef(true)
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const apps = useContext(AppsContext)
  const setTags = useContext(SetTagsContext)

  // IndexedDBからリアクティブに取得
  // appIndex は useTimeline 内で backendUrl から都度算出される
  const timeline = useTimeline('local')

  const [enableScrollToTop, setEnableScrollToTop] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)

  const internalIndex = useMemo(() => {
    return CENTER_INDEX - timeline.length
  }, [timeline.length])

  const setTagsEvent = useEffectEvent(setTags)

  // Local用ストリーミング処理
  // ※ このコンポーネントは localStreaming() のみを担当する
  useEffect(() => {
    if (apps.length <= 0) return
    if (process.env.NODE_ENV === 'development' && refFirstRef.current) {
      refFirstRef.current = false
      return
    }

    const app = apps[0]
    const client = GetClient(app)
    const { backendUrl } = app

    // 初期データ取得（appIndex は永続化しない）
    client
      .getLocalTimeline({ limit: 40 })
      .then(async (res) => {
        await bulkUpsertStatuses(res.data, backendUrl, 'local')
      })
      .catch((error) => {
        console.error('Failed to fetch local timeline:', error)
      })

    // ストリーミング接続
    let stream: Awaited<ReturnType<typeof client.localStreaming>> | null = null

    client.localStreaming().then((s) => {
      stream = s

      stream.on('update', async (status: Entity.Status) => {
        setTagsEvent((prev) =>
          Array.from(new Set([...prev, ...status.tags.map((tag) => tag.name)])),
        )
        // appIndex は永続化しない
        await upsertStatus(status, backendUrl, 'local')
      })

      stream.on('connect', () => {
        console.info('connected localStreaming')
      })

      // deleteイベント: localストリームからの受信なので 'local' のみ除外
      stream.on('delete', async (id: string) => {
        await handleDeleteEvent(backendUrl, id, 'local')
      })

      stream.on('error', (err: Error) => {
        console.error(err)
        stream?.stop()
        const timeout = setTimeout(() => {
          stream?.start()
          console.info('reconnected localSocket')
          clearTimeout(timeout)
        }, 1000)
      })
    })

    return () => {
      stream?.stop()
    }
  }, [apps])

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

  const scrollToTopIfNeeded = useEffectEvent(() => {
    if (enableScrollToTop && !isScrolling) {
      scrollerRef.current?.scrollToIndex({
        behavior: 'smooth',
        index: 0,
      })
    }
  })

  useEffect(() => {
    void timeline
    scrollToTopIfNeeded()
  }, [timeline])

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
    <Panel className="relative" name="Local">
      <div className="absolute right-2 top-2 z-10">
        <TimelineStreamIcon />
      </div>
      <div className="h-full" onWheel={onWheel}>
        <Virtuoso
          atTopStateChange={atTopStateChange}
          data={timeline}
          firstItemIndex={internalIndex}
          initialTopMostItemIndex={timeline.length - 1}
          isScrolling={(scrolling) => {
            setIsScrolling(scrolling)
          }}
          itemContent={(_index, status) => (
            <Status key={status.id} status={status} />
          )}
          ref={scrollerRef}
        />
      </div>
    </Panel>
  )
}
