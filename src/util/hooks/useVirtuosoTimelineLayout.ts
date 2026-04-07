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
}: {
  /** config.id — 変更時に bottomExpansion をリセットする */
  configId: string
  /** 表示中のデータ配列の長さ */
  dataLength: number
}) {
  const scrollerRef = useRef<VirtuosoHandle>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [enableScrollToTop, setEnableScrollToTop] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)

  // loadOlder やストリーミングで末尾に追加されたアイテム数を同期的に追跡し、
  // firstItemIndex を安定させる（Virtuoso が誤ってプリペンドと解釈しないようにする）
  const bottomExpansionRef = useRef(0)
  const prevLengthRef = useRef(dataLength)

  // config 変更時に bottomExpansion をリセット
  useEffect(() => {
    void configId
    bottomExpansionRef.current = 0
  }, [configId])

  if (dataLength !== prevLengthRef.current) {
    const diff = dataLength - prevLengthRef.current
    if (diff > 0 && !enableScrollToTop) {
      bottomExpansionRef.current += diff
    }
    prevLengthRef.current = dataLength
  }

  const firstItemIndex = CENTER_INDEX - dataLength + bottomExpansionRef.current

  // ---- コールバック ----

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

  // 先頭追従: enableScrollToTop && データ変更時に自動スクロール
  useEffect(() => {
    void dataLength
    if (enableScrollToTop) {
      timer.current = setTimeout(() => {
        scrollToTop()
      }, 50)
    }
    return () => {
      if (timer.current != null) clearTimeout(timer.current)
    }
  }, [enableScrollToTop, dataLength, scrollToTop])

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
  } as const
}
