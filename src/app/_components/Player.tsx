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
import { toSecureResourceUrl } from 'util/secureResourceUrl'
import {
  extractYouTubeVideoId,
  getDirectEmbedUrl,
  isExternalVideo,
} from 'util/videoEmbed'

const playableTypes = ['audio', 'video', 'gifv'] as Readonly<
  Entity.Attachment['type'][]
>

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  )
}

function shouldIgnorePlayerKeydown(
  event: KeyboardEvent,
  playerRoot: HTMLElement | null,
): boolean {
  const target = event.target
  if (!(target instanceof Node)) return true
  if (isEditableKeyboardTarget(target)) return true
  if (
    target instanceof HTMLElement &&
    target.closest('[data-autocomplete-menu]') != null
  ) {
    return true
  }
  if (!playerRoot?.contains(target)) return true
  // Space はフォーカス中のボタンに任せる（二重トグル防止）
  if (event.code === 'Space' && target instanceof HTMLButtonElement) return true
  return false
}

function seekPlayed(
  player: React.RefObject<HTMLVideoElement | null>,
  delta: number,
  setPlayed: React.Dispatch<React.SetStateAction<number>>,
) {
  setPlayed((prev) => {
    const seekToPlayed =
      delta < 0 ? Math.max(0, prev + delta) : Math.min(0.9999999, prev + delta)
    if (player.current != null && player.current.duration > 0) {
      player.current.currentTime = seekToPlayed * player.current.duration
    }
    return seekToPlayed
  })
}

type PlayerSizeClasses = { h: string; w: string }

function renderPlayableMedia({
  attachment,
  classNamePlayerSize,
  currentUrl,
  currentYouTubeVideoId,
  externalEmbedFailed,
  handleProgress,
  onExternalEmbedError,
  player,
  playing,
  volume,
}: {
  attachment: Entity.Attachment
  classNamePlayerSize: PlayerSizeClasses
  currentUrl: string
  currentYouTubeVideoId: string | null
  externalEmbedFailed: boolean
  handleProgress: (event: React.SyntheticEvent<HTMLVideoElement>) => void
  onExternalEmbedError: () => void
  player: React.RefObject<HTMLVideoElement | null>
  playing: boolean
  volume: number
}): React.ReactNode {
  if (!playableTypes.includes(attachment.type)) {
    return null
  }

  if (!isExternalVideo(currentUrl)) {
    return (
      <ReactPlayer
        className="aspect-video"
        height={attachment.type === 'audio' ? 0 : classNamePlayerSize.h}
        loop
        onTimeUpdate={handleProgress}
        playing={playing}
        ref={player}
        src={currentUrl}
        volume={volume}
        width={'100%'}
      />
    )
  }

  if (externalEmbedFailed) {
    return (
      <div
        className={['relative aspect-video w-full', classNamePlayerSize.h].join(
          ' ',
        )}
      >
        {currentYouTubeVideoId == null ? (
          <div className="h-full w-full bg-black" />
        ) : (
          <img
            alt="YouTube thumbnail"
            className="h-full w-full object-contain"
            src={`https://img.youtube.com/vi/${currentYouTubeVideoId}/hqdefault.jpg`}
          />
        )}
        <a
          className="absolute inset-0 flex items-center justify-center bg-black/35 text-sm font-medium text-white underline"
          href={currentUrl}
          onClick={(event) => {
            event.stopPropagation()
          }}
          rel="noopener noreferrer"
          target="_blank"
        >
          Open externally
        </a>
      </div>
    )
  }

  return (
    <iframe
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      allowFullScreen
      className={['aspect-video w-full', classNamePlayerSize.h].join(' ')}
      // @ts-expect-error -- credentialless is a valid HTML attribute but not yet in React's type definitions
      credentialless=""
      onError={onExternalEmbedError}
      src={getDirectEmbedUrl(currentUrl) ?? currentUrl}
      style={{ border: 'none' }}
      title="Video player"
    />
  )
}

const PlayerController = () => {
  const { attachment, index } = useContext(PlayerContext)
  const setAttachment = useContext(SetPlayerContext)
  const { volume } = useContext(PlayerSettingContext)
  const setPlayerSetting = useContext(SetPlayerSettingContext)
  const { playerSize } = useContext(SettingContext)

  const player = useRef<HTMLVideoElement>(null)
  const playerRootRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState<boolean>(false)
  const [played, setPlayed] = useState<number>(0)
  const [seeking, setSeeking] = useState<boolean>(false)
  const [externalEmbedFailed, setExternalEmbedFailed] = useState(false)

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

  const onClickPlay = () => {
    setPlaying((prev) => !prev)
  }

  const onClickClose = useCallback(() => {
    setPlaying(false)
    setAttachment({
      attachment: [],
      index: null,
    })
  }, [setAttachment])

  const handleSeekMouseDown: MouseEventHandler<HTMLInputElement> = () => {
    setSeeking(true)
  }

  const handleSeekChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    setPlayed(parseFloat(e.target.value))
  }

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (shouldIgnorePlayerKeydown(e, playerRootRef.current)) return

    const canSeekNativePlayer =
      currentAttachment != null &&
      playableTypes.includes(currentAttachment.type) &&
      (!isExternalVideo(currentUrl) || externalEmbedFailed)

    switch (e.code) {
      case 'Space':
        e.preventDefault()
        setPlaying((prev) => !prev)
        break
      case 'ArrowLeft':
        if (!canSeekNativePlayer) break
        e.preventDefault()
        seekPlayed(player, -0.1, setPlayed)
        break
      case 'ArrowRight':
        if (!canSeekNativePlayer) break
        e.preventDefault()
        seekPlayed(player, 0.1, setPlayed)
        break
      case 'ArrowUp':
        e.preventDefault()
        setPlayerSetting((prev) => ({
          volume: Math.min(1, prev.volume + 0.05),
        }))
        break
      case 'ArrowDown':
        e.preventDefault()
        setPlayerSetting((prev) => ({
          volume: Math.max(0, prev.volume - 0.05),
        }))
        break
    }
  })

  useEffect(() => {
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const handleSeekMouseUp: MouseEventHandler<HTMLInputElement> = () => {
    setSeeking(false)
    if (player.current != null && player.current.duration > 0) {
      player.current.currentTime = played * player.current.duration
    }
  }

  const handleProgress = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    if (!seeking && event.currentTarget != null) {
      const video = event.currentTarget
      if (video.duration > 0) {
        const played = video.currentTime / video.duration
        setPlayed(played)
      }
    }
  }

  const playNext = () => {
    if (index == null) return
    setAttachment({
      attachment,
      index: (index + 1) % attachment.length,
    })
  }

  const playPrevious = () => {
    if (index == null) return
    setAttachment({
      attachment,
      index: (index - 1 + attachment.length) % attachment.length,
    })
  }

  const currentAttachment = index == null ? null : attachment[index]
  const currentUrl = toSecureResourceUrl(currentAttachment?.url) ?? ''
  const currentYouTubeVideoId = extractYouTubeVideoId(currentUrl)

  useEffect(() => {
    if (currentUrl === '') return
    setExternalEmbedFailed(false)
  }, [currentUrl])

  if (currentAttachment == null) return null

  const canSeekNativePlayer =
    playableTypes.includes(currentAttachment.type) &&
    (!isExternalVideo(currentUrl) || externalEmbedFailed)

  const playableMedia = renderPlayableMedia({
    attachment: currentAttachment,
    classNamePlayerSize,
    currentUrl,
    currentYouTubeVideoId,
    externalEmbedFailed,
    handleProgress,
    onExternalEmbedError: () => {
      setExternalEmbedFailed(true)
    },
    player,
    playing,
    volume,
  })

  return (
    <div
      className={[
        'fixed bottom-0 right-0 z-40 max-w-full',
        classNamePlayerSize.w,
      ].join(' ')}
      data-player
      ref={playerRootRef}
    >
      <div className=" bg-black" onClick={onClickPlay}>
        {playableMedia}
        {'image' === currentAttachment.type && (
          <img
            alt={currentAttachment.description ?? ''}
            className="h-full w-full object-contain"
            src={currentUrl}
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
            disabled={!canSeekNativePlayer}
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
