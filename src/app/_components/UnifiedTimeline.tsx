'use client'

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
import type { StatusAddAppIndex, TimelineConfigV2 } from 'types/types'
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
  fetchInitialData,
  fetchMoreData,
} from 'util/timelineFetcher'

/**
 * 統合タイムラインコンポーネント
 *
 * TimelineConfigV2 を受け取り、以下を統一的に処理する:
 * 1. データ取得（useTimelineData）
 * 2. 追加読み込み（endReached）
 * 3. スクロール管理（Virtuoso）
 *
 * ## ストリーミング
 * ストリーミング接続は StreamingManagerProvider が
 * TimelineSettingsV2 の変更に連動して一元管理する（syncStreamsEvent）。
 * UnifiedTimeline はストリーム管理を一切行わず、
 * IndexedDB のデータを useLiveQuery で監視するだけで済む。
 *
 * ## 初期データ取得
 * 初期データ取得も StreamingManagerProvider が一元管理する。
 * home タイムラインは StatusStoreProvider が
 * userStreaming + getHomeTimeline で既に取得済み。
 *
 * ## 表示名
 * config.label が設定されている場合はそれを使用し、
 * 未設定の場合は type + backendFilter から自動生成する。
 */
export const UnifiedTimeline = ({
  config,
  headerOffset,
}: {
  config: TimelineConfigV2
  headerOffset?: string
}) => {
  const apps = useContext(AppsContext)
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { initializing } = useOtherQueueProgress()

  // データ取得
  const {
    data: timeline,
    queryDuration,
    loadMore,
  } = useTimelineData(config) as {
    data: StatusAddAppIndex[]
    queryDuration: number | null
    loadMore: () => void
  }

  // moreLoad の同時実行防止フラグ
  const isFetchingMoreRef = useRef(false)

  // 各 backendUrl ごとに「これ以上古いデータがない」状態を追跡
  // fetchMoreData が FETCH_LIMIT 未満を返したら exhausted とみなす
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

  // 表示名の解決
  const displayName = useMemo(() => {
    if (config.label) return config.label
    return getDefaultTimelineName(config)
  }, [config])

  const internalIndex =
    CENTER_INDEX - currentLength + bottomExpansionRef.current

  // 追加読み込み（マルチバックエンド対応）
  //
  // 2つのページネーション機構を並行して実行する:
  // 1. loadMore(): SQLite クエリの LIMIT を拡張し、DB に既にある古い投稿を表示に含める
  // 2. fetchMoreData(): API から max_id ベースで追加データを取得し、DB に保存する
  //
  // SQLite に十分なデータがある場合は loadMore() だけで表示が増える。
  // API フェッチは DB にない古い投稿を補充するために常に実行される。
  // 両者は独立して動作し、DB への upsert は subscribe 経由で自動的に反映される。
  const moreLoad = useCallback(async () => {
    // 同時実行防止: 前回のフェッチが完了するまで新しいリクエストを抑制
    if (isFetchingMoreRef.current) return
    isFetchingMoreRef.current = true

    try {
      if (apps.length <= 0) return

      // SQLite クエリの表示件数を拡張
      loadMore()

      const targetUrls = resolveBackendUrls(
        normalizeBackendFilter(config.backendFilter, apps),
        apps,
      )

      // 全バックエンドが exhausted なら何もしない
      const activeUrls = targetUrls.filter(
        (url) => !exhaustedBackendsRef.current.has(url),
      )
      if (activeUrls.length === 0) return

      // 各 backendUrl ごとに DB 内の最古 status_id を算出して追加データをフェッチ
      // フィルタ済みタイムラインの最古IDではなく、DB 上のタイムラインタイプに
      // 紐づく最古IDを使うことで、フィルタで除外された投稿の先にある
      // 古い投稿も確実に取得できる
      await Promise.all(
        activeUrls.map(async (url) => {
          const app = apps.find((a) => a.backendUrl === url)
          if (!app) return 0

          const { getSqliteDb } = await import('util/db/sqlite/connection')
          const handle = await getSqliteDb()
          const timelineType = config.type as
            | 'home'
            | 'local'
            | 'public'
            | 'tag'

          // DB からタイムラインタイプに紐づく最古の status_id を取得
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
                  // fetchMore 用 max_id 解決（API 取得の補助）→ other
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
                // fetchMore 用 max_id 解決（API 取得の補助）→ other
                kind: 'other',
                returnValue: 'resultRows',
              },
            )) as string[][]
            if (rows.length > 0) {
              oldestId = rows[0][0]
            }
          }

          const client = GetClient(app)
          if (!oldestId) {
            try {
              await fetchInitialData(client, config, url)
              return 0
            } catch (error) {
              console.error(`Failed to fetch initial data for ${url}:`, error)
              return 0
            }
          }

          try {
            const count = await fetchMoreData(client, config, url, oldestId)
            if (count < FETCH_LIMIT) {
              exhaustedBackendsRef.current.add(url)
            }
            return count
          } catch (error) {
            console.error(`Failed to fetch more data for ${url}:`, error)
            return 0
          }
        }),
      )
    } finally {
      isFetchingMoreRef.current = false
    }
  }, [apps, config, loadMore])

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
        </>
      )}
    </Panel>
  )
}
