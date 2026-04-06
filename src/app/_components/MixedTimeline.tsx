'use client'

import { Notification } from 'app/_parts/Notification'
import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
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
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type {
  NotificationAddAppIndex,
  StatusAddAppIndex,
  TimelineConfigV2,
} from 'types/types'
import { CENTER_INDEX } from 'util/environment'
import { GetClient } from 'util/GetClient'
import { useOtherQueueProgress } from 'util/hooks/useOtherQueueProgress'
import { useTimelineData } from 'util/hooks/useTimelineData'
import { AppsContext } from 'util/provider/AppsProvider'
import {
  normalizeBackendFilter,
  resolveBackendUrls,
} from 'util/timelineConfigValidator'
import { getDefaultTimelineName } from 'util/timelineDisplayName'
import {
  FETCH_LIMIT,
  fetchMoreData,
  fetchMoreNotifications,
} from 'util/timelineFetcher'

/**
 * 混合タイムラインコンポーネント
 *
 * statuses と notifications の両方を含むクエリ結果を表示する。
 * 各アイテムの `_type` フィールドに基づいて Status / Notification を描き分ける。
 */
export const MixedTimeline = ({
  config,
  headerOffset,
}: {
  config: TimelineConfigV2
  headerOffset?: string
}) => {
  const {
    data: timeline,
    dbHasMore,
    queryDuration,
    loadMore,
  } = useTimelineData(config)
  const { initializing } = useOtherQueueProgress()
  const apps = useContext(AppsContext)
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // moreLoad の同時実行防止フラグ
  const isFetchingMoreRef = useRef(false)

  // 各 backendUrl ごとに「これ以上古いデータがない」状態を追跡
  const exhaustedBackendsRef = useRef(new Set<string>())

  const [enableScrollToTop, setEnableScrollToTop] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)

  // loadMore() やAPIフェッチで末尾に追加されたアイテム数を同期的に追跡し、
  // firstItemIndex を安定させる（Virtuoso が誤ってプリペンドと解釈しないようにする）
  // useEffect ではなく ref でレンダー中に同期計算することで、1フレームのズレを防ぐ
  const bottomExpansionRef = useRef(0)
  const prevLengthRef = useRef(timeline.length)

  // config 変更時に bottomExpansion と exhausted 状態をリセット
  const configId = config.id
  useEffect(() => {
    void configId
    bottomExpansionRef.current = 0
    exhaustedBackendsRef.current = new Set()
  }, [configId])

  const currentLength = timeline.length
  if (currentLength !== prevLengthRef.current) {
    const diff = currentLength - prevLengthRef.current
    if (diff > 0 && !enableScrollToTop) {
      bottomExpansionRef.current += diff
    }
    prevLengthRef.current = currentLength
  }

  const displayName = useMemo(() => {
    if (config.label) return config.label
    return getDefaultTimelineName(config)
  }, [config])

  const internalIndex =
    CENTER_INDEX - currentLength + bottomExpansionRef.current

  // 追加読み込み（マルチバックエンド対応）
  //
  // DB ファースト・API フォールバック:
  // 1. loadMore(): SQLite クエリの LIMIT を拡張し、DB に既にある古いアイテムを表示に含める
  // 2. fetchMoreData/fetchMoreNotifications(): DB が枯渇した場合のみ、API から追加データを取得
  //
  // dbHasMore が true の場合は loadMore() だけで表示が増える。
  // dbHasMore が false（DB 枯渇）の場合のみ API フェッチも実行される。
  const moreLoad = useCallback(async () => {
    // 同時実行防止: 前回のフェッチが完了するまで新しいリクエストを抑制
    if (isFetchingMoreRef.current) return
    isFetchingMoreRef.current = true

    try {
      if (apps.length <= 0) return

      // SQLite クエリの表示件数を拡張（常に実行）
      loadMore()

      // DB にまだデータがある場合は API フェッチをスキップ
      if (dbHasMore) return

      // --- ここから下は !dbHasMore の場合のみ実行 ---
      const targetUrls = resolveBackendUrls(
        normalizeBackendFilter(config.backendFilter, apps),
        apps,
      )

      // 全バックエンドが exhausted なら何もしない
      const activeUrls = targetUrls.filter(
        (url) => !exhaustedBackendsRef.current.has(url),
      )
      if (activeUrls.length === 0) return

      // 各 backendUrl ごとに DB 内の最古 ID を算出して追加データをフェッチ
      await Promise.all(
        activeUrls.map(async (url) => {
          const app = apps.find((a) => a.backendUrl === url)
          if (!app) return 0

          const { getSqliteDb } = await import('util/db/sqlite/connection')
          const handle = await getSqliteDb()
          const client = GetClient(app)

          // ステータスタイムラインの追加取得
          if (config.type !== 'notification') {
            const timelineType = config.type as
              | 'home'
              | 'local'
              | 'public'
              | 'tag'

            let oldestId: string | undefined

            if (config.type === 'tag') {
              const tags = config.tagConfig?.tags ?? []
              for (const tag of tags) {
                const rows = (await handle.execAsync(
                  `SELECT pb2.local_id
                   FROM posts p
                   INNER JOIN post_backend_ids pb2 ON pb2.post_id = p.id
                   INNER JOIN post_hashtags pht ON pht.post_id = p.id
                   INNER JOIN hashtags ht ON pht.hashtag_id = ht.id
                   INNER JOIN local_accounts la ON la.id = pb2.local_account_id
                   WHERE LOWER(ht.name) = LOWER(?) AND la.backend_url = ?
                   ORDER BY p.created_at_ms ASC
                   LIMIT 1;`,
                  {
                    bind: [tag, url],
                    kind: 'other',
                    returnValue: 'resultRows',
                  },
                )) as string[][]
                if (rows.length > 0) {
                  oldestId = rows[0][0]
                  break
                }
              }
            } else {
              const rows = (await handle.execAsync(
                `SELECT pb2.local_id
                 FROM posts p
                 INNER JOIN post_backend_ids pb2 ON pb2.post_id = p.id
                 INNER JOIN local_accounts la ON la.id = pb2.local_account_id
                 INNER JOIN timeline_entries te ON te.post_id = p.id AND te.local_account_id = la.id
                 WHERE la.backend_url = ? AND te.timeline_key = ?
                 ORDER BY p.created_at_ms ASC
                 LIMIT 1;`,
                {
                  bind: [url, timelineType],
                  kind: 'other',
                  returnValue: 'resultRows',
                },
              )) as string[][]
              if (rows.length > 0) {
                oldestId = rows[0][0]
              }
            }

            if (oldestId) {
              try {
                const count = await fetchMoreData(client, config, url, oldestId)
                if (count < FETCH_LIMIT) {
                  exhaustedBackendsRef.current.add(url)
                }
              } catch (error) {
                console.error(`Failed to fetch more data for ${url}:`, error)
              }
            }
          }

          // 通知の追加取得
          {
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

            if (rows.length > 0) {
              const oldestNotifId = rows[0][0]
              try {
                const count = await fetchMoreNotifications(
                  client,
                  url,
                  oldestNotifId,
                )
                if (count < FETCH_LIMIT) {
                  exhaustedBackendsRef.current.add(url)
                }
              } catch (error) {
                console.error(
                  `Failed to fetch more notifications for ${url}:`,
                  error,
                )
              }
            }
          }

          return 0
        }),
      )
    } finally {
      isFetchingMoreRef.current = false
    }
  }, [apps, config, dbHasMore, loadMore])

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
      headerOffset={headerOffset}
      name={displayName}
      onClickHeader={() => scrollToTop()}
      queryDuration={queryDuration}
    >
      {timeline.length === 0 && initializing ? (
        <TimelineLoading />
      ) : (
        <>
          {enableScrollToTop && <TimelineStreamIcon />}
          <Virtuoso
            atTopStateChange={atTopStateChange}
            atTopThreshold={20}
            data={timeline}
            endReached={moreLoad}
            firstItemIndex={internalIndex}
            increaseViewportBy={200}
            isScrolling={setIsScrolling}
            itemContent={(_, item) => {
              // Entity.Notification は type フィールドを持つ (StatusAddAppIndex は持たない)
              if ('type' in item) {
                return (
                  <Notification
                    key={item.id}
                    notification={item as NotificationAddAppIndex}
                    scrolling={enableScrollToTop ? false : isScrolling}
                  />
                )
              }
              return (
                <Status
                  key={item.id}
                  scrolling={enableScrollToTop ? false : isScrolling}
                  status={item as StatusAddAppIndex}
                />
              )
            }}
            onWheel={onWheel}
            ref={scrollerRef}
            totalCount={timeline.length}
          />
        </>
      )}
    </Panel>
  )
}
