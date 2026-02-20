'use client'

import { Notification } from 'app/_parts/Notification'
import { Panel } from 'app/_parts/Panel'
import { Status } from 'app/_parts/Status'
import { TimelineStreamIcon } from 'app/_parts/TimelineIcon'
import {
  useCallback,
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
import { useTimelineData } from 'util/hooks/useTimelineData'
import { getDefaultTimelineName } from 'util/timelineDisplayName'

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
  const { data: timeline, averageDuration, loadMore } = useTimelineData(config)
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [enableScrollToTop, setEnableScrollToTop] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)

  // loadMore() で末尾に追加されたアイテム数を同期的に追跡し、
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

  return (
    <Panel
      averageDuration={averageDuration}
      className="relative"
      headerOffset={headerOffset}
      name={displayName}
      onClickHeader={() => scrollToTop()}
    >
      {enableScrollToTop && <TimelineStreamIcon />}
      <Virtuoso
        atTopStateChange={atTopStateChange}
        atTopThreshold={20}
        data={timeline}
        endReached={loadMore}
        firstItemIndex={internalIndex}
        increaseViewportBy={200}
        isScrolling={setIsScrolling}
        itemContent={(_, item) => {
          // _type フィールドで Status と Notification を判別
          if ('_type' in item && item._type === 'notification') {
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
    </Panel>
  )
}
