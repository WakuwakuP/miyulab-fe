import { getDirectEmbedUrl } from 'util/videoEmbed'

/** The media controls shared by ReactPlayer's media element and YouTube. */
export type PlayerMediaHandle = Pick<
  HTMLVideoElement,
  'currentTime' | 'duration' | 'paused' | 'pause' | 'play'
>

type YouTubePlayer = {
  destroy: () => void
  getCurrentTime: () => number
  getDuration: () => number
  pauseVideo: () => void
  playVideo: () => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  setVolume: (volume: number) => void
}

type YouTubeAPI = {
  Player: new (
    iframe: HTMLIFrameElement,
    options: {
      events: {
        onAutoplayBlocked: () => void
        onError: () => void
        onReady: () => void
        onStateChange: (event: { data: number }) => void
      }
    },
  ) => YouTubePlayer
}

type YouTubeWindow = Window & {
  YT?: YouTubeAPI
  onYouTubeIframeAPIReady?: () => void
}

let apiPromise: Promise<YouTubeAPI> | undefined
const INITIALIZATION_TIMEOUT_MS = 15_000

export function loadYouTubeAPI(): Promise<YouTubeAPI> {
  const host = window as YouTubeWindow
  if (host.YT?.Player) return Promise.resolve(host.YT)
  if (apiPromise) return apiPromise

  apiPromise = new Promise<YouTubeAPI>((resolve, reject) => {
    const previousReady = host.onYouTubeIframeAPIReady
    const script = document.createElement('script')
    const restoreCallback = () => {
      if (host.onYouTubeIframeAPIReady === onReady) {
        host.onYouTubeIframeAPIReady = previousReady
      }
    }
    const fail = () => {
      clearTimeout(timeout)
      restoreCallback()
      script.remove()
      reject(new Error('Failed to load YouTube IFrame API'))
    }
    // iframe_api loads a second script. Its failure does not fire onerror on
    // our script, so bound initialization rather than cache a pending promise.
    const timeout = setTimeout(fail, INITIALIZATION_TIMEOUT_MS)
    const onReady = () => {
      clearTimeout(timeout)
      restoreCallback()
      if (host.YT?.Player) resolve(host.YT)
      else reject(new Error('YouTube IFrame API is unavailable'))
      previousReady?.()
    }
    host.onYouTubeIframeAPIReady = onReady
    script.onerror = fail
    script.async = true
    script.src = 'https://www.youtube.com/iframe_api'
    document.head.append(script)
  }).catch((error: unknown) => {
    apiPromise = undefined
    throw error
  })
  return apiPromise
}

/**
 * Attach the official API to an existing credentialless iframe. Letting the
 * API create the iframe would lose credentialless and break COEP isolation.
 * The container, not React, owns this iframe because API.destroy removes it.
 */
export function mountYouTubePlayer(
  container: HTMLElement,
  url: string,
  callbacks: {
    onError: () => void
    onPlayingChange: (playing: boolean) => void
    onProgress: (currentTime: number, duration: number) => void
  },
) {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('credentialless', '')
  iframe.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture'
  iframe.allowFullscreen = true
  iframe.className = 'h-full w-full border-0'
  iframe.title = 'Video player'
  const embedUrl = new URL(getDirectEmbedUrl(url) ?? url)
  embedUrl.searchParams.set('enablejsapi', '1')
  embedUrl.searchParams.set('origin', window.location.origin)
  iframe.src = embedUrl.href
  container.append(iframe)

  let apiPlayer: YouTubePlayer | undefined
  let ready = false
  let disposed = false
  let playing = false
  let volume = 1
  let progressTimer: ReturnType<typeof setInterval> | undefined
  let readyTimeout: ReturnType<typeof setTimeout> | undefined

  const setPlaying = (value: boolean) => {
    playing = value
    if (!ready) return
    if (value) apiPlayer?.playVideo()
    else apiPlayer?.pauseVideo()
  }
  const setVolume = (value: number) => {
    volume = value
    if (ready) apiPlayer?.setVolume(Math.round(value * 100))
  }
  const media: PlayerMediaHandle = {
    get currentTime() {
      return ready ? (apiPlayer?.getCurrentTime() ?? 0) : 0
    },
    set currentTime(seconds: number) {
      if (ready && Number.isFinite(seconds)) apiPlayer?.seekTo(seconds, true)
    },
    get duration() {
      return ready ? (apiPlayer?.getDuration() ?? 0) : 0
    },
    pause: () => setPlaying(false),
    get paused() {
      return !playing
    },
    play: async () => setPlaying(true),
  }

  void loadYouTubeAPI()
    .then((api) => {
      if (disposed) return
      readyTimeout = setTimeout(() => {
        if (!disposed) callbacks.onError()
      }, INITIALIZATION_TIMEOUT_MS)
      apiPlayer = new api.Player(iframe, {
        events: {
          onAutoplayBlocked: () => {
            if (disposed) return
            playing = false
            callbacks.onPlayingChange(false)
          },
          onError: () => {
            clearTimeout(readyTimeout)
            if (!disposed) callbacks.onError()
          },
          onReady: () => {
            if (disposed) return
            clearTimeout(readyTimeout)
            ready = true
            setVolume(volume)
            setPlaying(playing)
            progressTimer = setInterval(() => {
              callbacks.onProgress(media.currentTime, media.duration)
            }, 250)
          },
          onStateChange: ({ data }) => {
            if (disposed || !ready) return
            if (data === 0) {
              // Match the native player's loop behavior.
              apiPlayer?.seekTo(0, true)
              setPlaying(true)
            } else if (data === 1 || data === 2 || data === 5) {
              playing = data === 1
              callbacks.onPlayingChange(playing)
            }
          },
        },
      })
    })
    .catch(() => {
      clearTimeout(readyTimeout)
      if (!disposed) callbacks.onError()
    })

  return {
    destroy: () => {
      disposed = true
      clearInterval(progressTimer)
      clearTimeout(readyTimeout)
      apiPlayer?.destroy()
      iframe.remove()
    },
    media,
    setPlaying,
    setVolume,
  }
}
