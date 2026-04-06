'use client'

import { Notification } from 'app/_parts/Notification'
import { Panel } from 'app/_parts/Panel'
import { TimelineStreamIcon } from 'app/_parts/TimelineIcon'
import { TimelineLoading } from 'app/_parts/TimelineLoading'
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEventHandler,
} from 'react'
import { CgSpinner } from 'react-icons/cg'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type { NotificationAddAppIndex, TimelineConfigV2 } from 'types/types'
import { CENTER_INDEX } from 'util/environment'
import { GetClient } from 'util/GetClient'
import { useOtherQueueProgress } from 'util/hooks/useOtherQueueProgress'
import { useTimelineData } from 'util/hooks/useTimelineData'
import { AppsContext } from 'util/provider/AppsProvider'
import {
  normalizeBackendFilter,
  resolveBackendUrls,
} from 'util/timelineConfigValidator'
import { FETCH_LIMIT, fetchMoreNotifications } from 'util/timelineFetcher'

export const NotificationTimeline = ({
  config,
  headerOffset,
}: {
  config: TimelineConfigV2
  headerOffset?: string
}) => {
  const {
    data: rawData,
    dbHasMore,
    queryDuration,
    loadMore,
  } = useTimelineData(config)
  const apps = useContext(AppsContext)
  const { initializing } = useOtherQueueProgress()
  // Runtime type guard: filter out any non-notification items that may slip through
  const notifications = useMemo(
    () =>
      rawData.filter((item): item is NotificationAddAppIndex => 'type' in item),
    [rawData],
  )
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFetchingMoreRef = useRef(false)
  const hasReachedEndRef = useRef(false)
  const exhaustedBackendsRef = useRef(new Set<string>())

  const [enableScrollToTop, setEnableScrollToTop] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)
  const [isFetchingMore, setIsFetchingMore] = useState(false)

  // loadMore() で末尾に追加されたアイテム数を同期的に追跡し、
  // firstItemIndex を安定させる（Virtuoso が誤ってプリペンドと解釈しないようにする）
  // useEffect ではなく ref でレンダー中に同期計算することで、1フレームのズレを防ぐ
  const bottomExpansionRef = useRef(0)
  const prevLengthRef = useRef(notifications.length)

  // config 変更時に bottomExpansion と exhausted 状態をリセット
  const configId = config.id
  useEffect(() => {
    void configId
    bottomExpansionRef.current = 0
    exhaustedBackendsRef.current = new Set()
    hasReachedEndRef.current = false
  }, [configId])

  const currentLength = notifications.length
  if (currentLength !== prevLengthRef.current) {
    const diff = currentLength - prevLengthRef.current
    if (diff > 0 && !enableScrollToTop) {
      bottomExpansionRef.current += diff
    }
    prevLengthRef.current = currentLength
  }

  const internalIndex =
    CENTER_INDEX - currentLength + bottomExpansionRef.current

  // API からの通知フェッチ処理
  const fetchFromApi = useCallback(async () => {
    const targetUrls = resolveBackendUrls(
      normalizeBackendFilter(config.backendFilter, apps),
      apps,
    )

    const activeUrls = targetUrls.filter(
      (url) => !exhaustedBackendsRef.current.has(url),
    )
    if (activeUrls.length === 0) return

    await Promise.all(
      activeUrls.map(async (url) => {
        const app = apps.find((a) => a.backendUrl === url)
        if (!app) return 0

        const { getSqliteDb } = await import('util/db/sqlite/connection')
        const handle = await getSqliteDb()

        // DB から最古の通知 ID を取得
        const rows = (await handle.execAsync(
          `SELECT n.local_id
           FROM notifications n
           INNER JOIN local_accounts la ON la.id = n.local_account_id
           WHERE la.backend_url = ?
           ORDER BY n.created_at_ms ASC
           LIMIT 1;`,
          {
            bind: [url],
            kind: 'other',
            returnValue: 'resultRows',
          },
        )) as string[][]

        if (rows.length === 0) return 0

        const oldestId = rows[0][0]
        const client = GetClient(app)

        try {
          const count = await fetchMoreNotifications(client, url, oldestId)
          if (count < FETCH_LIMIT) {
            exhaustedBackendsRef.current.add(url)
          }
          return count
        } catch (error) {
          console.error(`Failed to fetch more notifications for ${url}:`, error)
          return 0
        }
      }),
    )
  }, [apps, config])

  // 追加読み込み（DB ファースト・API フォールバック）
  const moreLoad = useCallback(async () => {
    if (isFetchingMoreRef.current) return
    isFetchingMoreRef.current = true
    hasReachedEndRef.current = true

    try {
      if (apps.length <= 0) return

      // SQLite クエリの表示件数を拡張（常に実行）
      loadMore()

      if (!dbHasMore) {
        // DB 枯渇: API フェッチ実行
        setIsFetchingMore(true)
        try {
          await fetchFromApi()
        } finally {
          setIsFetchingMore(false)
        }
      }
    } finally {
      isFetchingMoreRef.current = false
    }
  }, [apps, dbHasMore, loadMore, fetchFromApi])

  // loadMore() 後に DB が枯渇した場合の自動 API フェッチ
  useEffect(() => {
    if (!dbHasMore && hasReachedEndRef.current && !isFetchingMoreRef.current) {
      isFetchingMoreRef.current = true
      setIsFetchingMore(true)
      fetchFromApi().finally(() => {
        isFetchingMoreRef.current = false
        setIsFetchingMore(false)
      })
    }
  }, [dbHasMore, fetchFromApi])

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
    void notifications.length // 明示的に依存があることを示す
    if (enableScrollToTop) {
      timer.current = setTimeout(() => {
        scrollToTop()
      }, 50)
    }
    return () => {
      if (timer.current == null) return
      clearTimeout(timer.current)
    }
  }, [enableScrollToTop, scrollToTop, notifications.length])

  const virtuosoComponents = useMemo(
    () => ({
      Footer: () =>
        isFetchingMore ? (
          <div className="flex items-center justify-center py-4">
            <CgSpinner className="animate-spin text-gray-400" size={24} />
          </div>
        ) : null,
    }),
    [isFetchingMore],
  )

  return (
    <Panel
      className="relative"
      headerOffset={headerOffset}
      name={config.label ?? 'Notification'}
      onClickHeader={() => {
        scrollToTop()
      }}
      queryDuration={queryDuration}
    >
      {notifications.length === 0 && initializing ? (
        <TimelineLoading />
      ) : (
        <>
          {enableScrollToTop && <TimelineStreamIcon />}
          <Virtuoso
            atTopStateChange={atTopStateChange}
            atTopThreshold={20}
            components={virtuosoComponents}
            data={notifications}
            endReached={moreLoad}
            firstItemIndex={internalIndex}
            increaseViewportBy={200}
            isScrolling={setIsScrolling}
            itemContent={(_, notification) => (
              <Notification
                key={notification.id}
                notification={notification}
                scrolling={enableScrollToTop ? false : isScrolling}
              />
            )}
            onWheel={onWheel}
            ref={scrollerRef}
            totalCount={notifications.length}
          />
        </>
      )}
    </Panel>
  )
}
