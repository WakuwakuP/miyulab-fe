import { getSpotifyUri } from 'util/spotifyEmbed'
import type { PlayerMediaHandle } from 'util/youtubePlayer'

export type SpotifyPlaybackState = {
  duration: number
  isPaused: boolean
  position: number
  playingURI?: string
}

export type SpotifyEmbedController = {
  addListener: (
    event: 'playback_update' | 'ready',
    listener: (event: { data?: SpotifyPlaybackState }) => void,
  ) => void
  destroy: () => void
  loadUri: (uri: string) => void
  pause: () => void
  play: () => void
  seek: (seconds: number) => void
}

export type SpotifyIFrameAPI = {
  createController: (
    element: HTMLElement,
    options: { uri?: string },
    callback: (controller: SpotifyEmbedController) => void,
  ) => void
}

type SpotifyGlobal = typeof globalThis & {
  onSpotifyIframeApiReady?: (api: SpotifyIFrameAPI) => void
  SpotifyIframeApi?: SpotifyIFrameAPI
}

const API_URL = 'https://open.spotify.com/embed/iframe-api/v1'
const INITIALIZATION_TIMEOUT_MS = 15_000

let apiPromise: Promise<SpotifyIFrameAPI> | undefined

export function loadSpotifyAPI(): Promise<SpotifyIFrameAPI> {
  const host = globalThis as SpotifyGlobal
  if (host.SpotifyIframeApi) return Promise.resolve(host.SpotifyIframeApi)
  if (apiPromise) return apiPromise

  apiPromise = new Promise<SpotifyIFrameAPI>((resolve, reject) => {
    const previousReady = host.onSpotifyIframeApiReady
    const script = document.createElement('script')
    const restoreCallback = () => {
      if (host.onSpotifyIframeApiReady === onReady) {
        host.onSpotifyIframeApiReady = previousReady
      }
    }
    const fail = () => {
      clearTimeout(timeout)
      restoreCallback()
      script.remove()
      reject(new Error('Failed to load Spotify iFrame API'))
    }
    const timeout = setTimeout(fail, INITIALIZATION_TIMEOUT_MS)
    const resolveApi = (api?: SpotifyIFrameAPI) => {
      const loaded = api ?? host.SpotifyIframeApi
      if (loaded == null) return
      clearTimeout(timeout)
      restoreCallback()
      resolve(loaded)
      previousReady?.(loaded)
    }
    const onReady = (api?: SpotifyIFrameAPI) => resolveApi(api)
    host.onSpotifyIframeApiReady = onReady
    script.onerror = fail
    // The API script can define the global without invoking the ready callback.
    script.onload = () => resolveApi()
    script.async = true
    script.src = API_URL
    document.head.append(script)
  }).catch((error: unknown) => {
    apiPromise = undefined
    throw error
  })
  return apiPromise
}

/**
 * Spotify replaces the target with its own iframe. Create it without a URI so
 * credentialless can be set before navigation inside this COEP-isolated app.
 */
export function mountSpotifyPlayer(
  container: HTMLElement,
  url: string,
  callbacks: {
    onError: () => void
    onPlayingChange: (playing: boolean) => void
    onProgress: (currentTime: number, duration: number) => void
  },
) {
  const target = document.createElement('div')
  container.append(target)

  let iframe: HTMLIFrameElement | null = null
  let controller: SpotifyEmbedController | undefined
  let ready = false
  let disposed = false
  let playing = false
  let currentTime = 0
  let duration = 0
  let readyTimeout: ReturnType<typeof setTimeout> | undefined

  // Spotify exposes no programmatic volume control, so volume stays whatever
  // the embed itself renders; the Player disables its volume slider for this.
  const setPlaying = (value: boolean) => {
    playing = value
    if (!ready || controller == null) return
    if (value) controller.play()
    else controller.pause()
  }

  const media: PlayerMediaHandle = {
    get currentTime() {
      return currentTime
    },
    set currentTime(seconds: number) {
      if (ready && controller != null && Number.isFinite(seconds)) {
        currentTime = seconds
        controller.seek(seconds)
      }
    },
    get duration() {
      return duration
    },
    pause: () => setPlaying(false),
    get paused() {
      return !playing
    },
    async play() {
      setPlaying(true)
    },
  }

  const uri = getSpotifyUri(url)
  if (uri == null) {
    callbacks.onError()
    return {
      destroy: () => {
        disposed = true
        clearTimeout(readyTimeout)
        target.remove()
      },
      media,
      setPlaying,
    }
  }

  const handlePlaybackUpdate = (event: { data?: SpotifyPlaybackState }) => {
    if (disposed) return
    const data = event.data
    if (data == null) return

    const position = data.position / 1000
    const total = data.duration / 1000
    if (Number.isFinite(total) && total !== duration) duration = total
    if (Number.isFinite(position) && position !== currentTime) {
      currentTime = position
    }

    const wasPlaying = playing
    playing = !data.isPaused
    if (playing !== wasPlaying) callbacks.onPlayingChange(playing)
    callbacks.onProgress(currentTime, duration)
  }

  void loadSpotifyAPI()
    .then((api) => {
      if (disposed) return
      readyTimeout = setTimeout(() => {
        if (!disposed && !ready) callbacks.onError()
      }, INITIALIZATION_TIMEOUT_MS)
      api.createController(target, {}, (created) => {
        if (disposed) {
          created.destroy()
          return
        }
        controller = created
        iframe = container.querySelector('iframe')
        if (iframe == null) throw new Error('Spotify iframe was not created')
        iframe.setAttribute('credentialless', '')
        iframe.className = 'h-full w-full border-0'
        iframe.title = 'Spotify player'
        created.addListener('ready', () => {
          if (disposed) return
          clearTimeout(readyTimeout)
          ready = true
          // The embed starts paused, so only a pending play request must be
          // replayed here.
          if (playing) created.play()
          callbacks.onProgress(currentTime, duration)
        })
        created.addListener('playback_update', handlePlaybackUpdate)
        created.loadUri(uri)
      })
    })
    .catch(() => {
      clearTimeout(readyTimeout)
      if (!disposed) callbacks.onError()
    })

  return {
    destroy: () => {
      disposed = true
      clearTimeout(readyTimeout)
      controller?.destroy()
      iframe?.remove()
      target.remove()
    },
    media,
    setPlaying,
  }
}
