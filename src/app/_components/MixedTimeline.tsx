'use client'

import { Notification } from 'app/_parts/Notification'
import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import { TimelineStreamIcon } from 'app/_parts/TimelineIcon'
import { TimelineLoading } from 'app/_parts/TimelineLoading'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEventHandler,
} from 'react'
import { CgSpinner } from 'react-icons/cg'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type {
  NotificationAddAppIndex,
  StatusAddAppIndex,
  TimelineConfigV2,
} from 'types/types'
import { CENTER_INDEX } from 'util/environment'
import { useOtherQueueProgress } from 'util/hooks/useOtherQueueProgress'
import { useTimelineData } from 'util/hooks/useTimelineData'
import { getDefaultTimelineName } from 'util/timelineDisplayName'

/**
 * 混合タイムラインコンポーネント
 *
 * statuses と notifications の両方を含むクエリ結果を表示する。
 * 各アイテムの `type` フィールドに基づいて Status / Notification を描き分ける。
 *
 * データ取得・ページネーション・API フォールバックは useTimelineList に委譲。
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
    hasMore,
    isLoadingMore,
    loadOlder,
    queryDuration,
  } = useTimelineData(config)
  const { initializing } = useOtherQueueProgress()
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [enableScrollToTop, setEnableScrollToTop] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)

  // loadOlder やストリーミングで末尾に追加されたアイテム数を同期的に追跡し、
  // firstItemIndex を安定させる（Virtuoso が誤ってプリペンドと解釈しないようにする）
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

  const displayName = useMemo(() => {
    if (config.label) return config.label
    return getDefaultTimelineName(config)
  }, [config])

  const internalIndex =
    CENTER_INDEX - currentLength + bottomExpansionRef.current

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

  const virtuosoComponents = useMemo(
    () => ({
      Footer: () =>
        isLoadingMore ? (
          <div className="flex items-center justify-center py-4">
            <CgSpinner className="animate-spin text-gray-400" size={24} />
          </div>
        ) : null,
    }),
    [isLoadingMore],
  )

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
            components={virtuosoComponents}
            data={timeline}
            endReached={hasMore ? loadOlder : undefined}
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
