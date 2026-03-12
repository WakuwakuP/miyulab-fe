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

  const [enableScrollToTop, setEnableScrollToTop] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)

  // loadMore() やAPIフェッチで末尾に追加されたアイテム数を同期的に追跡し、
  // firstItemIndex を安定させる（Virtuoso が誤ってプリペンドと解釈しないようにする）
  // useEffect ではなく ref でレンダー中に同期計算することで、1フレームのズレを防ぐ
  const bottomExpansionRef = useRef(0)
  const prevLengthRef = useRef(timeline.length)

  // config 変更時に bottomExpansion をリセット
  const configId = config.id
  useEffect(() => {
    void configId
    bottomExpansionRef.current = 0
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
    if (apps.length <= 0 || timeline.length === 0) return

    // SQLite クエリの表示件数を拡張
    loadMore()

    const targetUrls = resolveBackendUrls(
      normalizeBackendFilter(config.backendFilter, apps),
      apps,
    )

    // 各 backendUrl ごとに最古の投稿 ID を算出して追加データをフェッチ
    await Promise.all(
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
          const { getSqliteDb } = await import('util/db/sqlite/connection')
          const handle = await getSqliteDb()
          const timelineType = config.type as
            | 'home'
            | 'local'
            | 'public'
            | 'tag'

          if (config.type === 'tag') {
            // タグタイムラインの場合は該当タグの最古投稿を取得
            const tags = config.tagConfig?.tags ?? []
            for (const tag of tags) {
              const rows = (await handle.execAsync(
                `SELECT s.post_id, s.origin_backend_url, s.created_at_ms, s.stored_at, s.json
                 FROM posts s
                 INNER JOIN posts_belonging_tags sbt ON s.post_id = sbt.post_id
                 WHERE sbt.tag = ? AND s.origin_backend_url = ?
                 ORDER BY s.created_at_ms ASC
                 LIMIT 1;`,
                { bind: [tag, url], returnValue: 'resultRows' },
              )) as (string | number)[][]
              if (rows.length > 0) {
                const status = JSON.parse(rows[0][4] as string)
                oldestStatus = {
                  ...status,
                  appIndex: apps.findIndex((a) => a.backendUrl === url),
                  backendUrl: rows[0][1] as string,
                  created_at_ms: rows[0][2] as number,
                  post_id: rows[0][0] as number,
                  storedAt: rows[0][3] as number,
                }
                break
              }
            }
          } else {
            // 通常のタイムラインの場合
            const rows = (await handle.execAsync(
              `SELECT s.post_id, s.origin_backend_url, s.created_at_ms, s.stored_at, s.json
               FROM posts s
               INNER JOIN posts_timeline_types stt ON s.post_id = stt.post_id
               WHERE s.origin_backend_url = ? AND stt.timelineType = ?
               ORDER BY s.created_at_ms ASC
               LIMIT 1;`,
              { bind: [url, timelineType], returnValue: 'resultRows' },
            )) as (string | number)[][]
            if (rows.length > 0) {
              const status = JSON.parse(rows[0][4] as string)
              oldestStatus = {
                ...status,
                appIndex: apps.findIndex((a) => a.backendUrl === url),
                backendUrl: rows[0][1] as string,
                created_at_ms: rows[0][2] as number,
                post_id: rows[0][0] as number,
                storedAt: rows[0][3] as number,
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
  }, [apps, timeline, config, loadMore])

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
    </Panel>
  )
}
