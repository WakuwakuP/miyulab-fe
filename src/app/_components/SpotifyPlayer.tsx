'use client'

import { type RefObject, useEffect, useEffectEvent, useRef } from 'react'
import { mountSpotifyPlayer } from 'util/spotifyPlayer'
import type { PlayerMediaHandle } from 'util/youtubePlayer'

export function SpotifyPlayer({
  className,
  onError,
  onPlayingChange,
  onProgress,
  player,
  playing,
  url,
}: Readonly<{
  className: string
  onError: () => void
  onPlayingChange: (playing: boolean) => void
  onProgress: (currentTime: number, duration: number) => void
  player: RefObject<PlayerMediaHandle | null>
  playing: boolean
  url: string
}>) {
  const container = useRef<HTMLDivElement>(null)
  const controller = useRef<ReturnType<typeof mountSpotifyPlayer> | null>(null)
  const handleError = useEffectEvent(onError)
  const handlePlayingChange = useEffectEvent(onPlayingChange)
  const handleProgress = useEffectEvent(onProgress)
  const initializeSettings = useEffectEvent(() => {
    // Spotify has no volume API, so only the playback request can be applied.
    controller.current?.setPlaying(playing)
  })

  useEffect(() => {
    if (!container.current) return
    const mounted = mountSpotifyPlayer(container.current, url, {
      onError: handleError,
      onPlayingChange: handlePlayingChange,
      onProgress: handleProgress,
    })
    controller.current = mounted
    player.current = mounted.media
    initializeSettings()
    return () => {
      // Native media can attach its ref before this passive cleanup runs.
      if (player.current === mounted.media) player.current = null
      controller.current = null
      mounted.destroy()
    }
  }, [url, player])

  useEffect(() => {
    controller.current?.setPlaying(playing)
  }, [playing])

  return <div className={className} ref={container} />
}
