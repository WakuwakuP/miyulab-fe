'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEventHandler,
} from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import { CENTER_INDEX } from 'util/environment'

/** Grow bottomExpansion when items are appended without shifting the virtual head. */
function bottomExpansionDelta(
  diff: number,
  previousKeys: readonly string[] | undefined,
  itemKeys: readonly string[] | undefined,
  enableScrollToTop: boolean,
): number {
  if (diff <= 0) return 0
  const oldHead = previousKeys?.[0]
  if (oldHead === undefined) {
    return enableScrollToTop ? 0 : diff
  }
  const headIndex = itemKeys?.indexOf(oldHead) ?? -1
  // Only rows inserted before the previous head shift its virtual index.
  if (headIndex >= 0) return diff - headIndex
  return enableScrollToTop ? 0 : diff
}

function syncBottomExpansion(
  dataLength: number,
  prevLengthRef: { current: number },
  bottomExpansionRef: { current: number },
  previousKeys: readonly string[] | undefined,
  itemKeys: readonly string[] | undefined,
  enableScrollToTop: boolean,
): void {
  if (dataLength === prevLengthRef.current) return
  const diff = dataLength - prevLengthRef.current
  bottomExpansionRef.current += bottomExpansionDelta(
    diff,
    previousKeys,
    itemKeys,
    enableScrollToTop,
  )
  prevLengthRef.current = dataLength
}

function syncAnchorCorrection(args: {
  itemKeys: readonly string[] | undefined
  previousKeys: readonly string[] | undefined
  enableScrollToTop: boolean
  visibleIndex: number
  previousFirstIndex: number
  baseIndex: number
}): { correction: number; visibleIndex: number } | null {
  const { itemKeys, previousKeys, enableScrollToTop } = args
  if (!itemKeys || !previousKeys || itemKeys === previousKeys) return null
  if (enableScrollToTop) return null
  const nextKeys = new Set(itemKeys)
  if (!previousKeys.some((key) => !nextKeys.has(key))) return null
  const anchor = retainedTimelineAnchor(
    previousKeys,
    itemKeys,
    args.visibleIndex,
  )
  if (!anchor) return { correction: 0, visibleIndex: args.visibleIndex }
  return {
    correction:
      args.previousFirstIndex +
      anchor.oldIndex -
      anchor.newIndex -
      args.baseIndex,
    visibleIndex: anchor.newIndex,
  }
}

/**
 * useVirtuosoTimelineLayout — Virtuoso 固有のスクロール管理を共通化するフック
 *
 * 3 つのタイムラインコンポーネント (UnifiedTimeline, MixedTimeline, NotificationTimeline)
 * で重複していた以下のロジックを 1 か所に集約する:
 *
 * - bottomExpansionRef による firstItemIndex の安定化
 * - enableScrollToTop / isScrolling 状態
 * - auto-scroll (先頭追従)
 * - Footer スピナー
 * - onWheel / atTopStateChange コールバック
 */
export function useVirtuosoTimelineLayout({
  configId,
  dataLength,
  itemKeys,
}: {
  /** config.id — 変更時に bottomExpansion をリセットする */
  configId: string
  /** 表示中のデータ配列の長さ */
  dataLength: number
  itemKeys?: readonly string[]
}) {
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [enableScrollToTop, setEnableScrollToTop] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)

  // loadOlder やストリーミングで末尾に追加されたアイテム数を同期的に追跡し、
  // firstItemIndex を安定させる（Virtuoso が誤ってプリペンドと解釈しないようにする）
  const bottomExpansionRef = useRef(0)
  const prevLengthRef = useRef(dataLength)
  const previousKeys = useRef(itemKeys)
  const visibleIndex = useRef(0)
  const scrollerElement = useRef<HTMLElement | null>(null)
  const anchorCorrection = useRef(0)
  const previousFirstIndex = useRef(CENTER_INDEX - dataLength)

  // config 変更時に bottomExpansion をリセット
  // biome-ignore lint/correctness/useExhaustiveDependencies: configId 変更時に Virtuoso の firstItemIndex 補正をリセット
  useEffect(() => {
    bottomExpansionRef.current = 0
    anchorCorrection.current = 0
    visibleIndex.current = 0
    previousKeys.current = undefined
  }, [configId])

  syncBottomExpansion(
    dataLength,
    prevLengthRef,
    bottomExpansionRef,
    previousKeys.current,
    itemKeys,
    enableScrollToTop,
  )

  const baseIndex = CENTER_INDEX - dataLength + bottomExpansionRef.current
  const syncedAnchor = syncAnchorCorrection({
    baseIndex,
    enableScrollToTop,
    itemKeys,
    previousFirstIndex: previousFirstIndex.current,
    previousKeys: previousKeys.current,
    visibleIndex: visibleIndex.current,
  })
  if (syncedAnchor) {
    anchorCorrection.current = syncedAnchor.correction
    visibleIndex.current = syncedAnchor.visibleIndex
  }
  previousKeys.current = itemKeys
  const firstItemIndex = baseIndex + anchorCorrection.current
  previousFirstIndex.current = firstItemIndex
  // Virtuoso ranges include overscan; use the row visible in the viewport.
  const captureVisibleIndex = useCallback(() => {
    const element = scrollerElement.current
    if (!element) return
    const top = element.getBoundingClientRect().top
    const firstVisible = [
      ...element.querySelectorAll<HTMLElement>('[data-index]'),
    ].find((row) => row.getBoundingClientRect().bottom > top)
    if (firstVisible) visibleIndex.current = Number(firstVisible.dataset.index)
  }, [])
  const setScrollerElement = useCallback(
    (element: HTMLElement | Window | null) => {
      scrollerElement.current?.removeEventListener(
        'scroll',
        captureVisibleIndex,
      )
      scrollerElement.current = element instanceof HTMLElement ? element : null
      scrollerElement.current?.addEventListener('scroll', captureVisibleIndex, {
        passive: true,
      })
    },
    [captureVisibleIndex],
  )

  // ---- コールバック ----

  const onWheel = useCallback<WheelEventHandler<HTMLDivElement>>((e) => {
    if (e.deltaY > 0) {
      setEnableScrollToTop(false)
    }
  }, [])

  const atTopStateChange = useCallback((state: boolean) => {
    setEnableScrollToTop(state)
  }, [])

  const scrollToTop = useCallback(() => {
    scrollerRef.current?.scrollToIndex({
      behavior: 'smooth',
      index: 0,
    })
  }, [])

  const headKey = itemKeys?.[0]
  // 新着で先頭が変わったときだけ追従する
  // biome-ignore lint/correctness/useExhaustiveDependencies: headKey 変更時に先頭へスクロール
  useEffect(() => {
    if (enableScrollToTop) {
      timer.current = setTimeout(() => {
        scrollToTop()
      }, 50)
    }
    return () => {
      if (timer.current != null) clearTimeout(timer.current)
    }
  }, [enableScrollToTop, headKey, scrollToTop])

  // ---- Footer コンポーネントファクトリ ----

  const createVirtuosoComponents = useMemo(
    () => (footer: (() => React.ReactNode) | null) =>
      footer ? { Footer: footer } : undefined,
    [],
  )

  return {
    atTopStateChange,
    createVirtuosoComponents,
    enableScrollToTop,
    firstItemIndex,
    isScrolling,
    onWheel,
    scrollerRef,
    scrollToTop,
    setIsScrolling,
    setScrollerElement,
  } as const
}

export function retainedTimelineAnchor(
  previous: readonly string[],
  next: readonly string[],
  visibleIndex: number,
): { oldIndex: number; newIndex: number } | null {
  const nextIndices = new Map(next.map((key, index) => [key, index]))
  for (
    let index = Math.min(visibleIndex, previous.length - 1);
    index < previous.length;
    index++
  ) {
    const newIndex = nextIndices.get(previous[index])
    if (newIndex !== undefined) return { newIndex, oldIndex: index }
  }
  for (
    let index = Math.min(visibleIndex - 1, previous.length - 1);
    index >= 0;
    index--
  ) {
    const newIndex = nextIndices.get(previous[index])
    if (newIndex !== undefined) return { newIndex, oldIndex: index }
  }
  return null
}
