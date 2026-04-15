'use client'

import { Panel } from 'app/_parts/Panel'
import { TimelineStreamIcon } from 'app/_parts/TimelineIcon'
import { TimelineLoading } from 'app/_parts/TimelineLoading'
import type { Entity } from 'megalodon'
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEventHandler,
} from 'react'
import { CgSpinner } from 'react-icons/cg'
import { RiPlayCircleLine } from 'react-icons/ri'
import { VirtuosoGrid, type VirtuosoGridHandle } from 'react-virtuoso'
import type { StatusAddAppIndex, TimelineConfigV2 } from 'types/types'
import { useOtherQueueProgress } from 'util/hooks/useOtherQueueProgress'
import { useTimelineData } from 'util/hooks/useTimelineData'
import { SetMediaModalContext } from 'util/provider/ModalProvider'
import { SetPlayerContext } from 'util/provider/PlayerProvider'
import { SettingContext } from 'util/provider/SettingProvider'
import { getDefaultTimelineName } from 'util/timelineDisplayName'

type MediaGalleryItem = {
  key: string
  attachment: Entity.Attachment
  attachments: Entity.Attachment[]
  index: number
  sensitive: boolean
}

const PLAYABLE_TYPES = new Set<Entity.Attachment['type']>([
  'video',
  'gifv',
  'audio',
])

type CellHandlers = {
  onOpen: (
    attachments: Entity.Attachment[],
    index: number,
    type: Entity.Attachment['type'],
  ) => void
  showSensitive: boolean
}

const MediaGalleryCell = memo(function MediaGalleryCell({
  item,
  handlers,
}: {
  item: MediaGalleryItem
  handlers: CellHandlers
}) {
  const [isShowSensitive, setIsShowSensitive] = useState<boolean>(
    handlers.showSensitive,
  )

  if (item.sensitive && !isShowSensitive) {
    return (
      <button
        className="flex aspect-square w-full items-center justify-center bg-gray-800 text-xs text-gray-300"
        onClick={() => setIsShowSensitive(true)}
        type="button"
      >
        Contents Warning
      </button>
    )
  }

  const previewUrl = item.attachment.preview_url ?? item.attachment.url
  const isPlayable = PLAYABLE_TYPES.has(item.attachment.type)

  return (
    <button
      className="group relative aspect-square w-full overflow-hidden bg-black"
      onClick={() =>
        handlers.onOpen(item.attachments, item.index, item.attachment.type)
      }
      type="button"
    >
      {previewUrl ? (
        <img
          alt=""
          className="h-full w-full object-cover"
          decoding="async"
          loading="lazy"
          src={previewUrl}
        />
      ) : (
        <div className="h-full w-full bg-gray-900" />
      )}
      {isPlayable && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
          <RiPlayCircleLine className="drop-shadow" size={32} />
        </div>
      )}
    </button>
  )
})

/** Lightweight placeholder shown during fast scroll */
const GridScrollSeekPlaceholder = () => (
  <div className="aspect-square w-full bg-gray-800/30" />
)

export const MediaGalleryTimeline = ({
  config,
  headerOffset,
}: {
  config: TimelineConfigV2
  headerOffset?: string
}) => {
  const {
    data: rawData,
    hasMoreOlder,
    isLoadingOlder,
    loadOlder,
    queryDuration,
  } = useTimelineData(config)
  const { initializing } = useOtherQueueProgress()
  const setting = useContext(SettingContext)
  const setMediaModal = useContext(SetMediaModalContext)
  const setPlayer = useContext(SetPlayerContext)

  const displayName = useMemo(() => {
    if (config.label) return config.label
    return getDefaultTimelineName(config)
  }, [config])

  // Cache preserves stable MediaGalleryItem references across re-computations.
  // Without this, every streaming update creates new item objects — React.memo
  // compares by reference, so all visible cells re-render even when unchanged.
  const mediaItemsCacheRef = useRef(new Map<string, MediaGalleryItem>())

  const mediaItems = useMemo((): MediaGalleryItem[] => {
    const prevCache = mediaItemsCacheRef.current
    const nextCache = new Map<string, MediaGalleryItem>()
    const items: MediaGalleryItem[] = []
    for (const item of rawData) {
      if ('type' in item) continue
      const status = item as StatusAddAppIndex
      const attachments =
        status.reblog?.media_attachments ?? status.media_attachments ?? []
      if (attachments.length === 0) continue
      const sensitive = status.reblog?.sensitive ?? status.sensitive ?? false
      for (let i = 0; i < attachments.length; i++) {
        const attachment = attachments[i]
        const attachmentKey =
          attachment.id ?? `${status.id}-media-${i.toString()}`
        const key = `${status.id}-${attachmentKey}`

        // Reuse cached item if content is unchanged (preserves reference for memo)
        const cached = prevCache.get(key)
        if (
          cached &&
          cached.sensitive === sensitive &&
          cached.attachment.preview_url === attachment.preview_url
        ) {
          nextCache.set(key, cached)
          items.push(cached)
        } else {
          const newItem: MediaGalleryItem = {
            attachment,
            attachments,
            index: i,
            key,
            sensitive,
          }
          nextCache.set(key, newItem)
          items.push(newItem)
        }
      }
    }
    mediaItemsCacheRef.current = nextCache
    return items
  }, [rawData])

  const scrollerRef = useRef<VirtuosoGridHandle>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [enableScrollToTop, setEnableScrollToTop] = useState(true)
  const dataLength = mediaItems.length

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
    scrollerRef.current?.scrollToIndex({ behavior: 'smooth', index: 0 })
  }, [])

  useEffect(() => {
    if (!enableScrollToTop || dataLength === 0) return
    timerRef.current = setTimeout(() => {
      scrollToTop()
    }, 50)
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [dataLength, enableScrollToTop, scrollToTop])

  const components = useMemo(
    () => ({
      Footer: () =>
        isLoadingOlder ? (
          <div className="flex items-center justify-center py-4">
            <CgSpinner className="animate-spin text-gray-400" size={24} />
          </div>
        ) : null,
      ScrollSeekPlaceholder: GridScrollSeekPlaceholder,
    }),
    [isLoadingOlder],
  )

  // Hoist context-dependent handler to parent; stable ref avoids cell re-renders
  const cellHandlers = useMemo<CellHandlers>(
    () => ({
      onOpen: (attachments, index, type) => {
        if (PLAYABLE_TYPES.has(type)) {
          setPlayer({ attachment: attachments, index })
          return
        }
        setMediaModal({ attachment: attachments, index })
      },
      showSensitive: setting.showSensitive,
    }),
    [setMediaModal, setPlayer, setting.showSensitive],
  )

  const itemContent = useCallback(
    (_index: number, item: MediaGalleryItem) => (
      <MediaGalleryCell handlers={cellHandlers} item={item} />
    ),
    [cellHandlers],
  )

  const computeItemKey = useCallback(
    (_index: number, item: MediaGalleryItem) => item.key,
    [],
  )

  const scrollSeekConfiguration = useMemo(
    () => ({
      enter: (velocity: number) => Math.abs(velocity) > 500,
      exit: (velocity: number) => Math.abs(velocity) < 100,
    }),
    [],
  )

  const endReached = useMemo(
    () => (hasMoreOlder ? loadOlder : undefined),
    [hasMoreOlder, loadOlder],
  )

  return (
    <Panel
      className="relative"
      headerOffset={headerOffset}
      name={displayName}
      onClickHeader={scrollToTop}
      queryDuration={queryDuration}
    >
      {mediaItems.length === 0 && initializing ? (
        <TimelineLoading />
      ) : (
        <>
          {enableScrollToTop && <TimelineStreamIcon />}
          <VirtuosoGrid
            atTopStateChange={atTopStateChange}
            components={components}
            computeItemKey={computeItemKey}
            data={mediaItems}
            endReached={endReached}
            increaseViewportBy={200}
            itemClassName="p-0"
            itemContent={itemContent}
            listClassName="grid grid-cols-2 gap-0 sm:grid-cols-3"
            onWheel={onWheel}
            ref={scrollerRef}
            scrollSeekConfiguration={scrollSeekConfiguration}
          />
        </>
      )}
    </Panel>
  )
}
