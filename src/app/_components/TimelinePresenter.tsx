'use client'

import { Panel } from 'app/_parts/Panel'
import { TimelineStreamIcon } from 'app/_parts/TimelineIcon'
import { TimelineLoading } from 'app/_parts/TimelineLoading'
import { type ReactNode, useMemo } from 'react'
import { CgSpinner } from 'react-icons/cg'
import { Virtuoso } from 'react-virtuoso'
import type { TimelineItem, TimelineViewModel } from 'types/timelineViewModel'
import { useVirtuosoTimelineLayout } from 'util/hooks/useVirtuosoTimelineLayout'

/**
 * TimelinePresenter — タイムライン描画の共通 Presenter
 *
 * TimelineViewModel を受け取り、Panel + Virtuoso でレンダリングする。
 * 行の描画は `renderItem` スロットで差し替え可能。
 *
 * Container (UnifiedTimeline 等) が ViewModel を組み立て、
 * この Presenter に渡す Container/Presenter パターンを採用。
 */
export function TimelinePresenter({
  headerOffset,
  renderItem,
  viewModel,
}: {
  viewModel: TimelineViewModel
  headerOffset?: string
  /** 各アイテムの描画関数。isScrolling は Virtuoso のスクロール中フラグ。 */
  renderItem: (item: TimelineItem, isScrolling: boolean) => ReactNode
}) {
  const {
    configId,
    data,
    displayName,
    hasMoreOlder,
    initializing,
    isLoadingOlder,
    loadOlder,
    queryDuration,
  } = viewModel

  const layout = useVirtuosoTimelineLayout({
    configId,
    dataLength: data.length,
  })

  const virtuosoComponents = useMemo(
    () => ({
      Footer: () =>
        isLoadingOlder ? (
          <div className="flex items-center justify-center py-4">
            <CgSpinner className="animate-spin text-gray-400" size={24} />
          </div>
        ) : null,
    }),
    [isLoadingOlder],
  )

  return (
    <Panel
      className="relative"
      headerOffset={headerOffset}
      name={displayName}
      onClickHeader={() => layout.scrollToTop()}
      queryDuration={queryDuration}
    >
      {data.length === 0 && initializing ? (
        <TimelineLoading />
      ) : (
        <>
          {layout.enableScrollToTop && <TimelineStreamIcon />}
          <Virtuoso
            atTopStateChange={layout.atTopStateChange}
            atTopThreshold={20}
            components={virtuosoComponents}
            data={data}
            endReached={hasMoreOlder ? loadOlder : undefined}
            firstItemIndex={layout.firstItemIndex}
            increaseViewportBy={200}
            isScrolling={layout.setIsScrolling}
            itemContent={(_, item) =>
              renderItem(
                item,
                layout.enableScrollToTop ? false : layout.isScrolling,
              )
            }
            onWheel={layout.onWheel}
            ref={layout.scrollerRef}
            totalCount={data.length}
          />
        </>
      )}
    </Panel>
  )
}
