'use client'

import {
  ChangeEventHandler,
  MouseEventHandler,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react'

import { createPortal } from 'react-dom'
import {
  GrChapterNext,
  GrChapterPrevious,
} from 'react-icons/gr'
import {
  RiCloseCircleLine,
  RiPauseFill,
  RiPlayFill,
} from 'react-icons/ri'
import ReactPlayer from 'react-player'
import { OnProgressProps } from 'react-player/base'

import {
  PlayerContext,
  PlayerSettingContext,
  SetPlayerContext,
  SetPlayerSettingContext,
} from 'util/provider/PlayerProvider'

const PlayerController = () => {
  const { attachment, index } = useContext(PlayerContext)
  const setAttachment = useContext(SetPlayerContext)
  const { volume } = useContext(PlayerSettingContext)
  const setPlayerSetting = useContext(
    SetPlayerSettingContext
  )

  const player = useRef<ReactPlayer>(null)
  const [playing, setPlaying] = useState<boolean>(false)
  const [played, setPlayed] = useState<number>(0)
  const [seeking, setSeeking] = useState<boolean>(false)

  const onClickPlay = useCallback(() => {
    setPlaying((prev) => !prev)
  }, [setPlaying])

  const onClickClose = useCallback(() => {
    setPlaying(false)
    setAttachment({
      attachment: [],
      index: null,
    })
  }, [setAttachment])

  const handleSeekMouseDown: MouseEventHandler<HTMLInputElement> =
    useCallback(() => {
      setSeeking(true)
    }, [setSeeking])

  const handleSeekChange: ChangeEventHandler<HTMLInputElement> =
    useCallback(
      (e) => {
        setPlayed(parseFloat(e.target.value))
      },
      [setPlayed]
    )

  const handleSeekMouseUp: MouseEventHandler<HTMLInputElement> =
    useCallback(() => {
      setSeeking(false)
      player.current?.seekTo(played)
    }, [setSeeking, played, player])

  const handleProgress = useCallback(
    (state: OnProgressProps) => {
      if (!seeking) {
        setPlayed(state.played)
      }
    },
    [seeking, setPlayed]
  )

  const playNext = useCallback(() => {
    if (index == null) return
    setAttachment({
      attachment,
      index: (index + 1) % attachment.length,
    })
  }, [attachment, index, setAttachment])

  const playPrevious = useCallback(() => {
    if (index == null) return
    setAttachment({
      attachment,
      index:
        (index - 1 + attachment.length) % attachment.length,
    })
  }, [attachment, index, setAttachment])

  if (attachment.length === 0 || index == null) return null
  return (
    <div className="fixed bottom-0 right-0 z-40">
      <div onClick={onClickPlay}>
        <ReactPlayer
          ref={player}
          url={attachment[index].url}
          playing={playing}
          volume={volume}
          onProgress={handleProgress}
          loop
          height={
            attachment[index].type === 'audio'
              ? 0
              : undefined
          }
        />
      </div>
      <div className="box-border flex h-12 items-center space-x-px bg-gray-700">
        <button
          className="flex h-12 w-12 shrink-0 items-center justify-center bg-black hover:bg-gray-800"
          onClick={onClickPlay}
        >
          {playing ? (
            <RiPauseFill size={30} />
          ) : (
            <RiPlayFill size={30} />
          )}
        </button>
        <button
          className="flex h-12 w-12 shrink-0 items-center justify-center bg-black hover:bg-gray-800"
          onClick={playPrevious}
        >
          <GrChapterPrevious size={30} />
        </button>
        <button
          className="flex h-12 w-12 shrink-0 items-center justify-center bg-black hover:bg-gray-800"
          onClick={playNext}
        >
          <GrChapterNext size={30} />
        </button>
        <div className="flex h-12 w-full shrink bg-black">
          <input
            className="w-full"
            type="range"
            min="0"
            max="0.9999999"
            step="any"
            value={played}
            onMouseDown={handleSeekMouseDown}
            onChange={handleSeekChange}
            onMouseUp={handleSeekMouseUp}
          />
        </div>
        <div className="flex h-12 w-32 shrink-0 bg-black">
          <input
            className="w-32"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => {
              setPlayerSetting({
                volume: parseFloat(e.target.value),
              })
            }}
          />
        </div>

        <button
          className="flex h-12 w-12 shrink-0 items-center justify-center bg-black hover:bg-gray-800"
          onClick={onClickClose}
        >
          <RiCloseCircleLine size={30} />
        </button>
      </div>
    </div>
  )
}

export const Player = () => {
  const { attachment, index } = useContext(PlayerContext)
  if (attachment.length === 0 || index == null) return null

  return createPortal(<PlayerController />, document.body)
}
