'use client'

import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import { TimelineStreamIcon } from 'app/_parts/TimelineIcon'
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
import { useTimelineData } from 'util/hooks/useTimelineData'
import { AppsContext } from 'util/provider/AppsProvider'
import {
  normalizeBackendFilter,
  resolveBackendUrls,
} from 'util/timelineConfigValidator'
import { getDefaultTimelineName } from 'util/timelineDisplayName'
import { fetchInitialData, fetchMoreData } from 'util/timelineFetcher'

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
export const UnifiedTimeline = ({ config }: { config: TimelineConfigV2 }) => {
  const apps = useContext(AppsContext)
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // データ取得
  const timeline = useTimelineData(config) as StatusAddAppIndex[]

  const [enableScrollToTop, setEnableScrollToTop] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)
  const [moreCount, setMoreCount] = useState(0)

  // 表示名の解決
  const displayName = useMemo(() => {
    if (config.label) return config.label
    return getDefaultTimelineName(config)
  }, [config])

  const internalIndex = useMemo(() => {
    return CENTER_INDEX - timeline.length + moreCount
  }, [timeline.length, moreCount])

  // 追加読み込み（マルチバックエンド対応）
  const moreLoad = useCallback(async () => {
    if (apps.length <= 0 || timeline.length === 0) return

    const targetUrls = resolveBackendUrls(
      normalizeBackendFilter(config.backendFilter, apps),
      apps,
    )

    // 各 backendUrl ごとに最古の投稿 ID を算出して追加データをフェッチ
    const results = await Promise.all(
      targetUrls.map(async (url) => {
        const app = apps.find((a) => a.backendUrl === url)
        if (!app) return 0

        // 該当 backend の最古投稿を取得
        // まず現在のタイムライン表示から探す
        let oldestStatus = timeline
          .filter((s) => apps[s.appIndex]?.backendUrl === url)
          .at(-1)

        // 表示上に該当バックエンドの投稿がない場合は DB から直接取得
        // （フィルタリングにより表示されていないが、実際には存在する可能性）
        if (!oldestStatus) {
          const { db } = await import('util/db/database')
          const timelineType = config.type as 'home' | 'local' | 'public' | 'tag'

          if (config.type === 'tag') {
            // タグタイムラインの場合は該当タグの最古投稿を取得
            const tags = config.tagConfig?.tags ?? []
            for (const tag of tags) {
              const oldest = await db.statuses
                .where('belongingTags')
                .equals(tag)
                .and((s) => s.backendUrl === url)
                .reverse()
                .first()
              if (oldest) {
                oldestStatus = {
                  ...oldest,
                  appIndex: apps.findIndex((a) => a.backendUrl === url),
                }
                break
              }
            }
          } else {
            // 通常のタイムラインの場合
            const oldest = await db.statuses
              .where('[backendUrl+created_at_ms]')
              .between([url, 0], [url, Date.now()])
              .and((s) => s.timelineTypes.includes(timelineType))
              .reverse()
              .first()
            if (oldest) {
              oldestStatus = {
                ...oldest,
                appIndex: apps.findIndex((a) => a.backendUrl === url),
              }
            }
          }
        }

        // それでも見つからない場合は初期データを取得
        if (!oldestStatus) {
          const client = GetClient(app)
          try {
            await fetchInitialData(client, config, url)
            return 0 // 初期データ取得のため追加カウントは0
          } catch (error) {
            console.error(`Failed to fetch initial data for ${url}:`, error)
            return 0
          }
        }

        // 追加データを取得
        const client = GetClient(app)
        try {
          return await fetchMoreData(client, config, url, oldestStatus.id)
        } catch (error) {
          console.error(`Failed to fetch more data for ${url}:`, error)
          return 0
        }
      }),
    )

    const totalFetched = results.reduce((sum, count) => sum + count, 0)
    setMoreCount((prev) => prev + totalFetched)
  }, [apps, timeline, config])

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
      name={displayName}
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
