import { useContext, useState } from 'react'

import { Entity } from 'megalodon'

import { Media } from 'app/_parts/Media'
import { SetMediaModalContext } from 'util/provider/ModalProvider'
import { SetPlayerContext } from 'util/provider/PlayerProvider'
import { SettingContext } from 'util/provider/SettingProvider'

export const MediaAttachments = ({
  sensitive,
  mediaAttachments,
}: {
  sensitive: boolean
  mediaAttachments: Entity.Attachment[]
}) => {
  const setting = useContext(SettingContext)
  const setMediaModal = useContext(SetMediaModalContext)
  const setPlayer = useContext(SetPlayerContext)
  const [isShowSensitive, setIsShowSensitive] =
    useState<boolean>(setting.showSensitive)

  if (mediaAttachments.length === 0) return null

  const onClick = (index: number) => {
    if (
      ['video', 'gifv', 'audio'].includes(
        mediaAttachments[index].type
      )
    ) {
      setPlayer({
        attachment: mediaAttachments,
        index,
      })
    } else {
      setMediaModal({
        attachment: mediaAttachments,
        index,
      })
    }
  }

  return (
    <div className="relative flex flex-wrap">
      {sensitive && (
        <>
          {!isShowSensitive ? (
            <div
              className="absolute z-10 flex h-full w-full cursor-pointer items-center justify-center bg-gray-800/50 p-2 text-gray-400 backdrop-blur-lg"
              onClick={() => {
                setIsShowSensitive(true)
              }}
            >
              <div>Contents Warning</div>
            </div>
          ) : (
            <button
              className="absolute left-2 top-2 z-10 rounded-md bg-gray-500/50 px-1 py-0.5"
              onClick={() => setIsShowSensitive(false)}
            >
              <div>Hide</div>
            </button>
          )}
        </>
      )}
      {mediaAttachments.map((media, index) => {
        switch (mediaAttachments.length) {
          case 1:
            return (
              <Media
                className="w-full bg-black"
                key={media.id}
                media={media}
                onClick={() => onClick(index)}
              />
            )
          case 2:
          case 4:
            return (
              <Media
                className="w-1/2 bg-black"
                key={media.id}
                media={media}
                onClick={() => onClick(index)}
              />
            )
          default:
            return (
              <Media
                className="w-1/3 bg-black"
                key={media.id}
                media={media}
                onClick={() => onClick(index)}
              />
            )
        }
      })}
    </div>
  )
}
