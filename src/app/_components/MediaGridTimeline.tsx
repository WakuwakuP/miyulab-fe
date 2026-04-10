'use client'

import { Media } from 'app/_parts/Media'
import { Panel } from 'app/_parts/Panel'
import { TimelineLoading } from 'app/_parts/TimelineLoading'
import type { Entity } from 'megalodon'
import { useCallback, useContext, useMemo } from 'react'
import type { StatusAddAppIndex, TimelineConfigV2 } from 'types/types'
import { useOtherQueueProgress } from 'util/hooks/useOtherQueueProgress'
import { useTimelineData } from 'util/hooks/useTimelineData'
import { SetMediaModalContext } from 'util/provider/ModalProvider'
import { SetPlayerContext } from 'util/provider/PlayerProvider'
import { getDefaultTimelineName } from 'util/timelineDisplayName'

/**
 * メディアグリッドタイムライン (Container)
 *
 * メディア付き投稿のサムネイルを3カラムのグリッドで表示する。
 * クリックするとメディアモーダルまたはプレイヤーを開く。
 */
export const MediaGridTimeline = ({
  config,
  headerOffset,
}: {
  config: TimelineConfigV2
  headerOffset?: string
}) => {
  // メディア付き投稿のみ取得
  const mediaConfig = useMemo(() => ({ ...config, onlyMedia: true }), [config])
  const { data, hasMoreOlder, isLoadingOlder, loadOlder, queryDuration } =
    useTimelineData(mediaConfig) as {
      data: StatusAddAppIndex[]
      hasMoreOlder: boolean
      isLoadingOlder: boolean
      loadOlder: () => Promise<void>
      queryDuration: number | null
    }
  const { initializing } = useOtherQueueProgress()
  const setMediaModal = useContext(SetMediaModalContext)
  const setPlayer = useContext(SetPlayerContext)

  const displayName = useMemo(() => {
    if (config.label) return config.label
    return getDefaultTimelineName(config)
  }, [config])

  // 各ステータスのメディアアタッチメントを展開してフラットなリストにする
  const mediaItems = useMemo(() => {
    const items: {
      attachment: Entity.Attachment
      attachments: Entity.Attachment[]
      attachmentIndex: number
      statusId: string
    }[] = []
    for (const status of data) {
      const attachments =
        status.reblog?.media_attachments ?? status.media_attachments
      for (let i = 0; i < attachments.length; i++) {
        items.push({
          attachment: attachments[i],
          attachmentIndex: i,
          attachments,
          statusId: status.id,
        })
      }
    }
    return items
  }, [data])

  const handleClick = useCallback(
    (
      attachment: Entity.Attachment,
      allAttachments: Entity.Attachment[],
      index: number,
    ) => {
      if (['video', 'gifv', 'audio'].includes(attachment.type)) {
        setPlayer({ attachment: allAttachments, index })
      } else {
        setMediaModal({ attachment: allAttachments, index })
      }
    },
    [setMediaModal, setPlayer],
  )

  return (
    <Panel
      className="relative overflow-y-auto"
      headerOffset={headerOffset}
      name={displayName}
      queryDuration={queryDuration}
    >
      {data.length === 0 && initializing ? (
        <TimelineLoading />
      ) : (
        <div className="flex flex-col">
          <div className="grid grid-cols-3 gap-px bg-gray-700">
            {mediaItems.map(
              ({ attachment, attachments, attachmentIndex, statusId }) => (
                <button
                  className="aspect-square overflow-hidden bg-black"
                  key={`${statusId}-${attachment.id}`}
                  onClick={() =>
                    handleClick(attachment, attachments, attachmentIndex)
                  }
                  type="button"
                >
                  <Media
                    className="h-full w-full"
                    media={attachment}
                    scrolling={false}
                  />
                </button>
              ),
            )}
          </div>
          {hasMoreOlder && (
            <button
              className="w-full py-3 text-xs text-gray-400 hover:text-white disabled:opacity-50"
              disabled={isLoadingOlder}
              onClick={loadOlder}
              type="button"
            >
              {isLoadingOlder ? '読み込み中…' : 'さらに読み込む'}
            </button>
          )}
        </div>
      )}
    </Panel>
  )
}
