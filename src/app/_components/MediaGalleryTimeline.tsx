'use client'

import { Panel } from 'app/_parts/Panel'
import { TimelineStreamIcon } from 'app/_parts/TimelineIcon'
import { TimelineLoading } from 'app/_parts/TimelineLoading'
import type { Entity } from 'megalodon'
import {
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

function MediaGalleryCell({
  item,
  scrolling,
}: {
  item: MediaGalleryItem
  scrolling: boolean
}) {
  const setting = useContext(SettingContext)
  const setMediaModal = useContext(SetMediaModalContext)
  const setPlayer = useContext(SetPlayerContext)
  const [isShowSensitive, setIsShowSensitive] = useState<boolean>(
    setting.showSensitive,
  )

  const onOpen = useCallback(() => {
    if (PLAYABLE_TYPES.has(item.attachment.type)) {
      setPlayer({ attachment: item.attachments, index: item.index })
      return
    }
    setMediaModal({ attachment: item.attachments, index: item.index })
  }, [
    item.attachment.type,
    item.attachments,
    item.index,
    setMediaModal,
    setPlayer,
  ])

  if (item.sensitive && !isShowSensitive) {
    return (
      <button
        className="flex aspect-square w-full items-center justify-center rounded bg-gray-800 text-xs text-gray-300"
        onClick={() => setIsShowSensitive(true)}
        type="button"
      >
        Contents Warning
      </button>
    )
  }

  if (scrolling) {
    return <div className="aspect-square w-full rounded bg-gray-800/30" />
  }

  const previewUrl = item.attachment.preview_url ?? item.attachment.url
  const isPlayable = PLAYABLE_TYPES.has(item.attachment.type)

  return (
    <button
      className="group relative aspect-square w-full overflow-hidden rounded bg-black"
      onClick={onOpen}
      type="button"
    >
      {previewUrl ? (
        <img
          alt=""
          className="h-full w-full object-cover"
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
}

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

  const displayName = useMemo(() => {
    if (config.label) return config.label
    return getDefaultTimelineName(config)
  }, [config])

  const mediaItems = useMemo((): MediaGalleryItem[] => {
    const items: MediaGalleryItem[] = []
    for (const item of rawData) {
      if ('type' in item) continue
      const status = item as StatusAddAppIndex
      const attachments =
        status.reblog?.media_attachments ?? status.media_attachments ?? []
      if (attachments.length === 0) continue
      const sensitive = status.reblog?.sensitive ?? status.sensitive ?? false
      attachments.forEach((attachment, index) => {
        const attachmentKey =
          attachment.id ?? `${status.id}-media-${index.toString()}`
        items.push({
          attachment,
          attachments,
          index,
          key: `${status.id}-${attachmentKey}`,
          sensitive,
        })
      })
    }
    return items
  }, [rawData])

  const scrollerRef = useRef<VirtuosoGridHandle>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [enableScrollToTop, setEnableScrollToTop] = useState(true)
  const [isScrolling, setIsScrolling] = useState(false)
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
    }),
    [isLoadingOlder],
  )

  const scrolling = enableScrollToTop ? false : isScrolling

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
            computeItemKey={(_, item) => item.key}
            data={mediaItems}
            endReached={hasMoreOlder ? loadOlder : undefined}
            increaseViewportBy={200}
            isScrolling={setIsScrolling}
            itemClassName="p-0"
            itemContent={(_, item) => (
              <MediaGalleryCell item={item} scrolling={scrolling} />
            )}
            listClassName="grid grid-cols-2 gap-0 sm:grid-cols-3"
            onWheel={onWheel}
            ref={scrollerRef}
            totalCount={mediaItems.length}
          />
        </>
      )}
    </Panel>
  )
}
