'use client'

import { type RefObject, useEffect, useEffectEvent, useRef } from 'react'
import { mountYouTubePlayer, type PlayerMediaHandle } from 'util/youtubePlayer'

export function YouTubePlayer({
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
  const container = useRef<HTMLDivElement>(null)
  const controller = useRef<ReturnType<typeof mountYouTubePlayer> | null>(null)
  const handleError = useEffectEvent(onError)
  const handlePlayingChange = useEffectEvent(onPlayingChange)
  const handleProgress = useEffectEvent(onProgress)
  const initializeSettings = useEffectEvent(() => {
    controller.current?.setPlaying(playing)
    controller.current?.setVolume(volume)
  })

  useEffect(() => {
    if (!container.current) return
    const mounted = mountYouTubePlayer(container.current, url, {
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

  useEffect(() => {
    controller.current?.setVolume(volume)
  }, [volume])

  return <div className={className} ref={container} />
}
