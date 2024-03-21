/* eslint-disable @next/next/no-img-element */
'use client'

import {
  ChangeEventHandler,
  MouseEventHandler,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { Entity } from 'megalodon'
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
import { SettingContext } from 'util/provider/SettingProvider'

const playableTypes = [
  'audio',
  'video',
  'gifv',
] as Readonly<Entity.Attachment['type'][]>

const PlayerController = () => {
  const { attachment, index } = useContext(PlayerContext)
  const setAttachment = useContext(SetPlayerContext)
  const { volume } = useContext(PlayerSettingContext)
  const setPlayerSetting = useContext(
    SetPlayerSettingContext
  )
  const { playerSize } = useContext(SettingContext)

  const player = useRef<ReactPlayer>(null)
  const [playing, setPlaying] = useState<boolean>(false)
  const [played, setPlayed] = useState<number>(0)
  const [seeking, setSeeking] = useState<boolean>(false)

  const classNamePlayerSize = useMemo(() => {
    switch (playerSize) {
      case 'small':
        return { w: 'w-[320px]', h: 'h-[180px]' }
      case 'medium':
        return { w: 'w-[640px]', h: 'h-[360px]' }
      case 'large':
        return { w: 'w-[820px]', h: 'h-[460px]' }
    }
  }, [playerSize])

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.target instanceof HTMLSelectElement) return
      if (e.target instanceof HTMLTextAreaElement) return
      if (e.code === 'Space') {
        e.preventDefault()
        setPlaying((prev) => !prev)
      }
      if (e.code === 'ArrowLeft') {
        e.preventDefault()
        setPlayed((prev) => {
          const seekToPlayed = Math.max(0, prev - 0.1)
          player.current?.seekTo(seekToPlayed)
          return seekToPlayed
        })
      }
      if (e.code === 'ArrowRight') {
        e.preventDefault()
        setPlayed((prev) => {
          const seekToPlayed = Math.min(
            0.9999999,
            prev + 0.1
          )
          player.current?.seekTo(seekToPlayed)
          return seekToPlayed
        })
      }
      if (e.code === 'ArrowUp') {
        e.preventDefault()
        setPlayerSetting((prev) => ({
          volume: Math.min(1, prev.volume + 0.05),
        }))
      }
      if (e.code === 'ArrowDown') {
        e.preventDefault()
        setPlayerSetting((prev) => ({
          volume: Math.max(0, prev.volume - 0.05),
        }))
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [setPlaying, setPlayed, setPlayerSetting, player])

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
    <div
      className={[
        'fixed bottom-0 right-0 z-40 max-w-full',
        classNamePlayerSize.w,
      ].join(' ')}
    >
      <div
        className=" bg-black"
        onClick={onClickPlay}
      >
        {playableTypes.includes(attachment[index].type) && (
          <ReactPlayer
            ref={player}
            url={attachment[index].url}
            playing={playing}
            volume={volume}
            onProgress={handleProgress}
            loop
            width={'100%'}
            height={
              attachment[index].type === 'audio'
                ? 0
                : classNamePlayerSize.h
            }
            className="aspect-video"
          />
        )}
        {'image' === attachment[index].type && (
          <img
            className="h-full w-full object-contain"
            src={attachment[index].url}
            alt={attachment[index].description ?? ''}
          />
        )}
      </div>
      <div className="box-border flex h-12 items-center space-x-px bg-gray-500 pt-[2px]">
        <button
          className="flex h-12 w-12 shrink-0 items-center justify-center bg-gray-800 hover:bg-gray-500"
          onClick={onClickPlay}
        >
          {playing ? (
            <RiPauseFill size={30} />
          ) : (
            <RiPlayFill size={30} />
          )}
        </button>
        {attachment.length > 1 && (
          <>
            <button
              className="flex h-12 w-12 shrink-0 items-center justify-center bg-gray-800 hover:bg-gray-500"
              onClick={playPrevious}
            >
              <GrChapterPrevious size={30} />
            </button>
            <button
              className="flex h-12 w-12 shrink-0 items-center justify-center bg-gray-800 hover:bg-gray-500"
              onClick={playNext}
            >
              <GrChapterNext size={30} />
            </button>
          </>
        )}
        <div className="flex h-12 w-full shrink bg-gray-800">
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
        <div className="flex h-12 w-32 shrink-0 bg-gray-800">
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
          className="flex h-12 w-12 shrink-0 items-center justify-center bg-gray-800 hover:bg-gray-500"
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
