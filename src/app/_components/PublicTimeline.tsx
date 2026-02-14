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

export const PublicTimeline = () => {
  const refFirstRef = useRef(true)
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const apps = useContext(AppsContext)
  const setTags = useContext(SetTagsContext)
  const setTagsEvent = useEffectEvent(setTags)

  // IndexedDBからリアクティブに取得
  // appIndex は useTimeline 内で backendUrl から都度算出される
  const timeline = useTimeline('public')

  const [enableScrollToTop, setEnableScrollToTop] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)

  const internalIndex = useMemo(() => {
    return CENTER_INDEX - timeline.length
  }, [timeline.length])

  // Public用ストリーミング処理
  // ※ このコンポーネントは publicStreaming() のみを担当する
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && refFirstRef.current) {
      refFirstRef.current = false
      return
    }
    if (apps.length <= 0) return

    const app = apps[0]
    const client = GetClient(app)
    const { backendUrl } = app

    // 初期データ取得（メディア付きのみ: APIパラメータ only_media: true）
    // appIndex は永続化しない
    client
      .getPublicTimeline({ limit: 40, only_media: true })
      .then(async (res) => {
        await bulkUpsertStatuses(res.data, backendUrl, 'public')
      })

    // ストリーミング接続
    let stream: Awaited<ReturnType<typeof client.publicStreaming>> | null = null

    client.publicStreaming().then((s) => {
      stream = s

      stream.on('update', async (status: Entity.Status) => {
        setTagsEvent((prev) =>
          Array.from(new Set([...prev, ...status.tags.map((tag) => tag.name)])),
        )
        // メディア付きの投稿のみ保存（ストリームは全投稿が流れるためJS側でフィルタ）
        if (status.media_attachments.length > 0) {
          await upsertStatus(status, backendUrl, 'public')
        }
      })

      stream.on('connect', () => {
        console.info('connected publicStreaming')
      })

      // deleteイベント: publicストリームからの受信なので 'public' のみ除外
      stream.on('delete', async (id: string) => {
        await handleDeleteEvent(backendUrl, id, 'public')
      })

      stream.on('error', (err: Error) => {
        console.error(err)
        stream?.stop()
        const timeout = setTimeout(() => {
          stream?.start()
          console.info('reconnected publicSocket')
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

  const scrollToTop = useCallback(() => {
    scrollerRef.current?.scrollToIndex({
      behavior: 'smooth',
      index: 0,
    })
  }, [])

  useEffect(() => {
    void timeline.length
    if (enableScrollToTop) {
      timer.current = setTimeout(() => {
        scrollToTop()
      }, 50)
    }
    return () => {
      if (timer.current != null) clearTimeout(timer.current)
    }
  }, [enableScrollToTop, timeline.length, scrollToTop])

  return (
    <Panel
      className="relative"
      name="Public"
      onClickHeader={() => scrollToTop()}
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
