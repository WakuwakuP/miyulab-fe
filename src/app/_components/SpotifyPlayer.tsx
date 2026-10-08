'use client'

import { captionsTrackSrc } from 'app/_parts/Media'
import {
  type RefObject,
  useCallback,
  useEffect,
  useEffectEvent,
  useState,
} from 'react'
import type { SpotifyPreview } from 'util/spotifyPreview'
import type { PlayerMediaHandle } from 'util/youtubePlayer'

export function SpotifyPlayer({
  className,
  onError,
  onPlayingChange,
  onProgress,
  player,
  playing,
  url,
  volume,
}: Readonly<{
  className: string
  onError: () => void
  onPlayingChange: (playing: boolean) => void
  onProgress: (currentTime: number, duration: number) => void
  player: RefObject<PlayerMediaHandle | null>
  playing: boolean
  url: string
  volume: number
}>) {
  const [preview, setPreview] = useState<SpotifyPreview | null>(null)
  const [trackIndex, setTrackIndex] = useState(0)
  const handleError = useEffectEvent(onError)
  const stopPlaying = useEffectEvent(() => onPlayingChange(false))
  const attachAudio = useCallback(
    (audio: HTMLAudioElement | null) => {
      player.current = audio
      if (!audio) return
      return () => {
        audio.pause()
        if (player.current === audio) player.current = null
      }
    },
    [player],
  )

  useEffect(() => {
    const abort = new AbortController()
    setPreview(null)
    setTrackIndex(0)
    void fetch(`/api/spotify-preview?url=${encodeURIComponent(url)}`, {
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Spotify preview is unavailable')
        const data: SpotifyPreview = await response.json()
        if (!abort.signal.aborted) setPreview(data)
      })
      .catch(() => {
        if (!abort.signal.aborted) handleError()
      })
    return () => abort.abort()
  }, [url])

  const track = preview?.tracks[trackIndex]
  useEffect(() => {
    if (!track) return
    const audio = player.current as HTMLAudioElement | null
    if (!audio) return
    // Apply the saved volume before any playback can start.
    audio.volume = volume
    if (playing && audio.paused) void audio.play().catch(() => stopPlaying())
    else if (!playing && !audio.paused) audio.pause()
  }, [player, playing, track, volume])

  return (
    <div className={`${className} flex flex-col bg-gray-900 p-3 text-white`}>
      <a
        className="font-bold underline"
        href={url}
        rel="noopener noreferrer"
        target="_blank"
      >
        {preview?.title ?? 'Spotify'}
      </a>
      <p className="text-sm text-gray-300">Spotify · プレビュー</p>
      {!preview && <output className="block">読み込み中…</output>}
      {preview && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {preview.tracks.map((item, index) => (
            <button
              aria-pressed={index === trackIndex}
              className="block w-full p-2 text-left hover:bg-gray-700 aria-pressed:bg-gray-700"
              // biome-ignore lint/suspicious/noArrayIndexKey: The fixed playlist can repeat the same track.
              key={`${item.url}-${index}`}
              onClick={() => {
                if (index === trackIndex) return
                onProgress(0, 1)
                setTrackIndex(index)
              }}
              type="button"
            >
              <span className="block">{item.title}</span>
              <span className="block text-sm text-gray-300">
                {item.subtitle}
              </span>
            </button>
          ))}
        </div>
      )}
      {track && (
        <audio
          key={track.url}
          onEnded={() => {
            if (preview && trackIndex + 1 < preview.tracks.length) {
              onProgress(0, 1)
              setTrackIndex(trackIndex + 1)
              onPlayingChange(true)
            } else onPlayingChange(false)
          }}
          onError={onError}
          onPause={(event) => {
            if (event.currentTarget === player.current) onPlayingChange(false)
          }}
          onPlay={(event) => {
            if (event.currentTarget === player.current) onPlayingChange(true)
          }}
          onTimeUpdate={(event) => {
            onProgress(
              event.currentTarget.currentTime,
              event.currentTarget.duration,
            )
          }}
          preload="metadata"
          ref={attachAudio}
          src={track.url}
        >
          <track
            kind="captions"
            label="Captions"
            src={captionsTrackSrc(track.title)}
            srcLang="und"
          />
        </audio>
      )}
    </div>
  )
}
