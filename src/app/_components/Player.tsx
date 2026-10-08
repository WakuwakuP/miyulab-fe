/* eslint-disable @next/next/no-img-element */
'use client'

import { SpotifyPlayer } from 'app/_components/SpotifyPlayer'
import { YouTubePlayer } from 'app/_components/YouTubePlayer'
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
  type PlayerEmbedProvider,
  type PlayerMediaMode,
  type PlayerSizeTokens,
  resolvePlayerEmbedProvider,
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
import { extractSpotifyEmbedTarget } from 'util/spotifyEmbed'
import { extractYouTubeVideoId } from 'util/videoEmbed'
import type { PlayerMediaHandle } from 'util/youtubePlayer'

function seekPlayed(
  player: React.RefObject<PlayerMediaHandle | null>,
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

function togglePlayback(
  player: React.RefObject<PlayerMediaHandle | null>,
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>,
) {
  const el = player.current
  if (el == null) {
    // Ref may be unset on first paint or right after src change; fall back
    // to the controlled `playing` prop so the gesture still toggles playback.
    setPlaying((prev) => !prev)
    return
  }
  if (el.paused) {
    el.play().catch(() => {
      setPlaying(false)
    })
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
  embedId,
  embedProvider,
  handleProgress,
  mediaMode,
  onExternalEmbedError,
  onPlayingChange,
  player,
  playing,
  volume,
}: {
  attachment: Entity.Attachment
  classNamePlayerSize: PlayerSizeTokens
  currentUrl: string
  embedId: string | null
  embedProvider: PlayerEmbedProvider
  handleProgress: (currentTime: number, duration: number) => void
  mediaMode: PlayerMediaMode
  onExternalEmbedError: () => void
  onPlayingChange: (playing: boolean) => void
  player: React.RefObject<PlayerMediaHandle | null>
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
        onTimeUpdate={(event: React.SyntheticEvent<HTMLVideoElement>) => {
          handleProgress(
            event.currentTarget.currentTime,
            event.currentTarget.duration,
          )
        }}
        playing={playing}
        ref={player as React.RefObject<HTMLVideoElement | null>}
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
        {embedId == null || embedProvider !== 'youtube' ? (
          <div className="h-full w-full bg-black" />
        ) : (
          <img
            alt="YouTube thumbnail"
            className="h-full w-full object-contain"
            src={`https://img.youtube.com/vi/${embedId}/hqdefault.jpg`}
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
    const embedClassName = [
      'aspect-video w-full',
      classNamePlayerSize.hClass,
    ].join(' ')

    if (embedProvider === 'spotify') {
      return (
        <SpotifyPlayer
          className={embedClassName}
          onError={onExternalEmbedError}
          onPlayingChange={onPlayingChange}
          onProgress={handleProgress}
          player={player}
          playing={playing}
          url={currentUrl}
        />
      )
    }

    return (
      <YouTubePlayer
        className={embedClassName}
        onError={onExternalEmbedError}
        onPlayingChange={onPlayingChange}
        onProgress={handleProgress}
        player={player}
        playing={playing}
        url={currentUrl}
        volume={volume}
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

  const player = useRef<PlayerMediaHandle>(null)
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
  const [trackedUrl, setTrackedUrl] = useState(currentUrl)
  const embedProvider = resolvePlayerEmbedProvider(currentUrl)
  const embedId =
    embedProvider === 'spotify'
      ? (extractSpotifyEmbedTarget(currentUrl)?.id ?? null)
      : extractYouTubeVideoId(currentUrl)
  const mediaMode = resolvePlayerMediaMode({
    attachmentType: currentAttachment?.type,
    currentUrl,
    embedProvider,
    externalEmbedFailed,
  })
  const controls = getPlayerControlCapabilities(
    mediaMode,
    attachment.length,
    embedProvider,
  )

  // Reset playback state while rendering so the first paint after a track
  // switch never keeps `playing={true}` with the new src (avoids a blip).
  if (currentUrl !== trackedUrl) {
    setTrackedUrl(currentUrl)
    if (currentUrl !== '') {
      setExternalEmbedFailed(false)
      setPlayed(0)
      setSeeking(false)
      setPlaying(false)
    }
  }

  const onClickPlay = () => {
    if (!controls.canPlayPause) return
    togglePlayback(player, setPlaying)
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
    const fraction = Number.parseFloat(e.target.value)
    setPlayed(fraction)
    // onChange also covers touch and keyboard range input, not just mouseup.
    if (player.current != null && player.current.duration > 0) {
      player.current.currentTime = fraction * player.current.duration
    }
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
        togglePlayback(player, setPlaying)
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
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  }, [currentUrl])

  const handleSeekMouseUp: MouseEventHandler<HTMLInputElement> = () => {
    setSeeking(false)
    if (player.current != null && player.current.duration > 0) {
      player.current.currentTime = played * player.current.duration
    }
  }

  const handleProgress = (currentTime: number, duration: number) => {
    if (!seeking && Number.isFinite(duration) && duration > 0) {
      setPlayed(currentTime / duration)
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
    embedId,
    embedProvider,
    handleProgress,
    mediaMode,
    onExternalEmbedError: () => {
      setExternalEmbedFailed(true)
    },
    onPlayingChange: setPlaying,
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
    >
      {mediaMode === 'native' ? (
        <button
          aria-label={playing ? 'Pause media' : 'Play media'}
          aria-pressed={playing}
          className="block w-full appearance-none border-0 bg-black p-0"
          onClick={onClickPlay}
          type="button"
        >
          {playableMedia}
        </button>
      ) : (
        <div className="bg-black">
          {playableMedia}
          {currentAttachment.type === 'image' && (
            <img
              alt={currentAttachment.description ?? ''}
              className="h-full w-full object-contain"
              src={currentUrl}
            />
          )}
        </div>
      )}
      <div className="box-border flex h-12 items-center space-x-px bg-gray-500 pt-[2px]">
        <button
          aria-label={playing ? 'Pause media' : 'Play media'}
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
              aria-label="Previous media"
              className="flex h-12 w-12 shrink-0 items-center justify-center bg-gray-800 hover:bg-gray-500"
              onClick={playPrevious}
              type="button"
            >
              <GrChapterPrevious size={30} />
            </button>
            <button
              aria-label="Next media"
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
            aria-label="Seek media"
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
            aria-label="Media volume"
            className="w-32 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!controls.canVolume}
            max="1"
            min="0"
            onChange={(e) => {
              setPlayerSetting({
                volume: Number.parseFloat(e.target.value),
              })
            }}
            step="0.01"
            type="range"
            value={volume}
          />
        </div>
        <button
          aria-label="Close player"
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
