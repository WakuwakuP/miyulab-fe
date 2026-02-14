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
import { useTagTimeline } from 'util/hooks/useTimeline'
import { AppsContext } from 'util/provider/AppsProvider'
import { SetTagsContext } from 'util/provider/ResourceProvider'

export const TagTimeline = ({ tag }: { tag: string }) => {
  const refFirstRef = useRef(true)
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const apps = useContext(AppsContext)
  const setTags = useContext(SetTagsContext)
  // useEffectEvent の互換性注記: 05-timeline-provider.md 参照
  const setTagsEvent = useEffectEvent(setTags)

  // IndexedDBからリアクティブに取得
  // appIndex は useTagTimeline 内で backendUrl から都度算出される
  // onlyMedia: true でメディア付き投稿のみ表示（保存は全投稿）
  const timeline = useTagTimeline(tag, { onlyMedia: true })

  const [enableScrollToTop, setEnableScrollToTop] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)
  const [moreCount, setMoreCount] = useState(0)

  const internalIndex = useMemo(() => {
    return CENTER_INDEX - timeline.length + moreCount
  }, [timeline.length, moreCount])

  // Tag用ストリーミング処理
  // ※ このコンポーネントは tagStreaming(tag) のみを担当する
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && refFirstRef.current) {
      refFirstRef.current = false
      return
    }
    if (apps.length <= 0) return

    const app = apps[0]
    const client = GetClient(app)
    const { backendUrl } = app

    // 初期データ取得（appIndex は永続化しない）
    // 全投稿を保存する（メディアフィルタは表示層で行う）
    client.getTagTimeline(tag, { limit: 40 }).then(async (res) => {
      await bulkUpsertStatuses(res.data, backendUrl, 'tag', tag)
    })

    // ストリーミング接続
    let stream: Awaited<ReturnType<typeof client.tagStreaming>> | null = null

    client.tagStreaming(tag).then((s) => {
      stream = s

      stream.on('update', async (status: Entity.Status) => {
        setTagsEvent((prev) =>
          Array.from(new Set([...prev, ...status.tags.map((t) => t.name)])),
        )
        // 全投稿を保存する（メディアフィルタは useTagTimeline の onlyMedia オプションで行う）
        await upsertStatus(status, backendUrl, 'tag', tag)
      })

      stream.on('connect', () => {
        console.info('connected tagStreaming')
      })

      // deleteイベント: tagストリームからの受信なので 'tag' + 該当タグのみ除外
      // belongingTags からも該当タグが除去される（removeFromTimeline 内で処理）
      stream.on('delete', async (id: string) => {
        await handleDeleteEvent(backendUrl, id, 'tag', tag)
      })

      stream.on('error', (err: Error) => {
        console.error(err)
        stream?.stop()
        const timeout = setTimeout(() => {
          stream?.start()
          console.info('reconnected tagSocket')
          clearTimeout(timeout)
        }, 1000)
      })
    })

    return () => {
      stream?.stop()
    }
  }, [apps, tag])

  // 追加読み込み（appIndex は永続化しない）
  // 全投稿を保存する（メディアフィルタは表示層で行う）
  const moreLoad = async () => {
    if (apps.length <= 0 || timeline.length === 0) return

    const client = GetClient(apps[0])
    const { backendUrl } = apps[0]

    const res = await client.getTagTimeline(tag, {
      limit: 40,
      max_id: timeline[timeline.length - 1].id,
    })

    setMoreCount((prev) => prev + res.data.length)
    await bulkUpsertStatuses(res.data, backendUrl, 'tag', tag)
  }

  // UIロジック
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
      name={`#${tag}`}
      onClickHeader={() => scrollToTop()}
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
