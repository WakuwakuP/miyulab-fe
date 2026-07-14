/* eslint-disable @next/next/no-img-element */
'use client'

import type { Entity } from 'megalodon'
import React, {
  type ChangeEventHandler,
  type MouseEventHandler,
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
  getPlayerControlCapabilities,
  getPlayerSizeTokens,
  isPlayableAttachmentType,
  type PlayerMediaMode,
  type PlayerSizeTokens,
  resolvePlayerMediaMode,
  shouldIgnorePlayerKeydownTarget,
} from 'util/playerMediaMode'
import {
  PlayerContext,
  PlayerSettingContext,
  SetPlayerContext,
  SetPlayerSettingContext,
} from 'util/provider/PlayerProvider'
import { SettingContext } from 'util/provider/SettingProvider'
import { toSecureResourceUrl } from 'util/secureResourceUrl'
import { extractYouTubeVideoId, getDirectEmbedUrl } from 'util/videoEmbed'

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

function toggleNativePlayback(
  player: React.RefObject<HTMLVideoElement | null>,
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>,
) {
  const el = player.current
  if (el == null) return
  if (el.paused) {
    void el.play()
    setPlaying(true)
  } else {
    el.pause()
    setPlaying(false)
  }
}

function renderPlayableMedia({
  attachment,
  classNamePlayerSize,
  currentUrl,
  currentYouTubeVideoId,
  handleProgress,
  mediaMode,
  onExternalEmbedError,
  player,
  playing,
  volume,
}: {
  attachment: Entity.Attachment
  classNamePlayerSize: PlayerSizeTokens
  currentUrl: string
  currentYouTubeVideoId: string | null
  handleProgress: (event: React.SyntheticEvent<HTMLVideoElement>) => void
  mediaMode: PlayerMediaMode
  onExternalEmbedError: () => void
  player: React.RefObject<HTMLVideoElement | null>
  playing: boolean
  volume: number
}): React.ReactNode {
  if (!isPlayableAttachmentType(attachment.type)) {
    return null
  }

  if (mediaMode === 'native') {
    return (
      <ReactPlayer
        className="aspect-video"
        height={attachment.type === 'audio' ? 0 : classNamePlayerSize.hPx}
        loop
        onTimeUpdate={handleProgress}
        playing={playing}
        ref={player}
        src={currentUrl}
        volume={volume}
        width="100%"
      />
    )
  }

  if (mediaMode === 'fallback') {
    return (
      <div
        className={[
          'relative aspect-video w-full',
          classNamePlayerSize.hClass,
        ].join(' ')}
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

  if (mediaMode === 'iframe') {
    return (
      <iframe
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        className={['aspect-video w-full', classNamePlayerSize.hClass].join(
          ' ',
        )}
        // @ts-expect-error -- credentialless is a valid HTML attribute but not yet in React's type definitions
        credentialless=""
        onError={onExternalEmbedError}
        src={getDirectEmbedUrl(currentUrl) ?? currentUrl}
        style={{ border: 'none' }}
        title="Video player"
      />
    )
  }

  return null
}

const PlayerController = () => {
  const { attachment, index } = useContext(PlayerContext)
  const setAttachment = useContext(SetPlayerContext)
  const { volume } = useContext(PlayerSettingContext)
  const setPlayerSetting = useContext(SetPlayerSettingContext)
  const { playerSize } = useContext(SettingContext)

  const player = useRef<HTMLVideoElement>(null)
  const playerRootRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [played, setPlayed] = useState(0)
  const [seeking, setSeeking] = useState(false)
  const [externalEmbedFailed, setExternalEmbedFailed] = useState(false)

  const classNamePlayerSize = useMemo(
    () => getPlayerSizeTokens(playerSize),
    [playerSize],
  )

  const currentAttachment = index == null ? null : attachment[index]
  const currentUrl = toSecureResourceUrl(currentAttachment?.url) ?? ''
  const currentYouTubeVideoId = extractYouTubeVideoId(currentUrl)
  const mediaMode = resolvePlayerMediaMode({
    attachmentType: currentAttachment?.type,
    currentUrl,
    externalEmbedFailed,
  })
  const controls = getPlayerControlCapabilities(mediaMode, attachment.length)

  const onClickPlay = () => {
    if (!controls.canPlayPause) return
    toggleNativePlayback(player, setPlaying)
  }

  const onClickClose = () => {
    setPlaying(false)
    setAttachment({
      attachment: [],
      index: null,
    })
  }

  const handleSeekMouseDown: MouseEventHandler<HTMLInputElement> = () => {
    setSeeking(true)
  }

  const handleSeekChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    setPlayed(parseFloat(e.target.value))
  }

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (shouldIgnorePlayerKeydownTarget(e.target)) return
    // Space はフォーカス中のボタンに任せる（二重トグル防止）
    if (e.code === 'Space' && e.target instanceof HTMLButtonElement) return

    switch (e.code) {
      case 'Escape':
        e.preventDefault()
        onClickClose()
        break
      case 'Space':
        if (!controls.canPlayPause) break
        e.preventDefault()
        toggleNativePlayback(player, setPlaying)
        break
      case 'ArrowLeft':
        if (!controls.canSeek) break
        e.preventDefault()
        seekPlayed(player, -0.1, setPlayed)
        break
      case 'ArrowRight':
        if (!controls.canSeek) break
        e.preventDefault()
        seekPlayed(player, 0.1, setPlayed)
        break
      case 'ArrowUp':
        if (!controls.canVolume) break
        e.preventDefault()
        setPlayerSetting((prev) => ({
          volume: Math.min(1, prev.volume + 0.05),
        }))
        break
      case 'ArrowDown':
        if (!controls.canVolume) break
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

  useEffect(() => {
    if (currentUrl === '') return
    setExternalEmbedFailed(false)
    setPlayed(0)
    setPlaying(false)
    playerRootRef.current?.focus({ preventScroll: true })
  }, [currentUrl])

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
        setPlayed(video.currentTime / video.duration)
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

  if (currentAttachment == null) return null

  const playableMedia = renderPlayableMedia({
    attachment: currentAttachment,
    classNamePlayerSize,
    currentUrl,
    currentYouTubeVideoId,
    handleProgress,
    mediaMode,
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
        'fixed bottom-0 right-0 z-40 max-w-full outline-none',
        classNamePlayerSize.wClass,
      ].join(' ')}
      data-player
      ref={playerRootRef}
      tabIndex={-1}
    >
      <div
        className="bg-black"
        onClick={controls.canPlayPause ? onClickPlay : undefined}
      >
        {playableMedia}
        {currentAttachment.type === 'image' && (
          <img
            alt={currentAttachment.description ?? ''}
            className="h-full w-full object-contain"
            src={currentUrl}
          />
        )}
      </div>
      <div className="box-border flex h-12 items-center space-x-px bg-gray-500 pt-[2px]">
        <button
          className="flex h-12 w-12 shrink-0 items-center justify-center bg-gray-800 hover:bg-gray-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-gray-800"
          disabled={!controls.canPlayPause}
          onClick={onClickPlay}
          title={
            controls.canPlayPause
              ? undefined
              : 'Use the embedded player controls'
          }
          type="button"
        >
          {playing ? <RiPauseFill size={30} /> : <RiPlayFill size={30} />}
        </button>
        {controls.canPrevNext && (
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
            className="w-full disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!controls.canSeek}
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
            className="w-32 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!controls.canVolume}
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
