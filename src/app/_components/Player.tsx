/* eslint-disable @next/next/no-img-element */
'use client'

import type { Entity } from 'megalodon'
import React, {
  type ChangeEventHandler,
  type MouseEventHandler,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { GrChapterNext, GrChapterPrevious } from 'react-icons/gr'
import { RiCloseCircleLine, RiPauseFill, RiPlayFill } from 'react-icons/ri'
import ReactPlayer from 'react-player'

import {
  PlayerContext,
  PlayerSettingContext,
  SetPlayerContext,
  SetPlayerSettingContext,
} from 'util/provider/PlayerProvider'
import { SettingContext } from 'util/provider/SettingProvider'

const playableTypes = ['audio', 'video', 'gifv'] as Readonly<
  Entity.Attachment['type'][]
>

const PlayerController = () => {
  const { attachment, index } = useContext(PlayerContext)
  const setAttachment = useContext(SetPlayerContext)
  const { volume } = useContext(PlayerSettingContext)
  const setPlayerSetting = useContext(SetPlayerSettingContext)
  const { playerSize } = useContext(SettingContext)

  const player = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState<boolean>(false)
  const [played, setPlayed] = useState<number>(0)
  const [seeking, setSeeking] = useState<boolean>(false)

  const classNamePlayerSize = useMemo(() => {
    switch (playerSize) {
      case 'small':
        return { h: 'h-[180px]', w: 'w-[320px]' }
      case 'medium':
        return { h: 'h-[360px]', w: 'w-[640px]' }
      case 'large':
        return { h: 'h-[460px]', w: 'w-[820px]' }
    }
  }, [playerSize])

  const onClickPlay = useCallback(() => {
    setPlaying((prev) => !prev)
  }, [])

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
    }, [])

  const handleSeekChange: ChangeEventHandler<HTMLInputElement> = useCallback(
    (e) => {
      setPlayed(parseFloat(e.target.value))
    },
    [],
  )

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
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
        if (player.current != null && player.current.duration > 0) {
          player.current.currentTime = seekToPlayed * player.current.duration
        }
        return seekToPlayed
      })
    }
    if (e.code === 'ArrowRight') {
      e.preventDefault()
      setPlayed((prev) => {
        const seekToPlayed = Math.min(0.9999999, prev + 0.1)
        if (player.current != null && player.current.duration > 0) {
          player.current.currentTime = seekToPlayed * player.current.duration
        }
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
  })

  useEffect(() => {
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const handleSeekMouseUp: MouseEventHandler<HTMLInputElement> =
    useCallback(() => {
      setSeeking(false)
      if (player.current != null && player.current.duration > 0) {
        player.current.currentTime = played * player.current.duration
      }
    }, [played])

  const handleProgress = useCallback(
    (event: React.SyntheticEvent<HTMLVideoElement>) => {
      if (!seeking && event.currentTarget != null) {
        const video = event.currentTarget
        if (video.duration > 0) {
          const played = video.currentTime / video.duration
          setPlayed(played)
        }
      }
    },
    [seeking],
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
      index: (index - 1 + attachment.length) % attachment.length,
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
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClickPlay()
          }
        }}
        role="button"
        tabIndex={0}
      >
        {playableTypes.includes(attachment[index].type) && (
          <ReactPlayer
            className="aspect-video"
            height={
              attachment[index].type === 'audio' ? 0 : classNamePlayerSize.h
            }
            loop
            onTimeUpdate={handleProgress}
            playing={playing}
            ref={player}
            src={attachment[index].url}
            volume={volume}
            width={'100%'}
          />
        )}
        {'image' === attachment[index].type && (
          <img
            alt={attachment[index].description ?? ''}
            className="h-full w-full object-contain"
            src={attachment[index].url}
          />
        )}
      </div>
      <div className="box-border flex h-12 items-center space-x-px bg-gray-500 pt-[2px]">
        <button
          className="flex h-12 w-12 shrink-0 items-center justify-center bg-gray-800 hover:bg-gray-500"
          onClick={onClickPlay}
          type="button"
        >
          {playing ? <RiPauseFill size={30} /> : <RiPlayFill size={30} />}
        </button>
        {attachment.length > 1 && (
          <>
            <button
              className="flex h-12 w-12 shrink-0 items-center justify-center bg-gray-800 hover:bg-gray-500"
              onClick={playPrevious}
              type="button"
            >
              <GrChapterPrevious size={30} />
            </button>
            <button
              className="flex h-12 w-12 shrink-0 items-center justify-center bg-gray-800 hover:bg-gray-500"
              onClick={playNext}
              type="button"
            >
              <GrChapterNext size={30} />
            </button>
          </>
        )}
        <div className="flex h-12 w-full shrink bg-gray-800">
          <input
            className="w-full"
            max="0.9999999"
            min="0"
            onChange={handleSeekChange}
            onMouseDown={handleSeekMouseDown}
            onMouseUp={handleSeekMouseUp}
            step="any"
            type="range"
            value={played}
          />
        </div>
        <div className="flex h-12 w-32 shrink-0 bg-gray-800">
          <input
            className="w-32"
            max="1"
            min="0"
            onChange={(e) => {
              setPlayerSetting({
                volume: parseFloat(e.target.value),
              })
            }}
            step="0.01"
            type="range"
            value={volume}
          />
        </div>
        <button
          className="flex h-12 w-12 shrink-0 items-center justify-center bg-gray-800 hover:bg-gray-500"
          onClick={onClickClose}
          type="button"
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
