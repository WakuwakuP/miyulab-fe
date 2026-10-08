import type {
  SpotifyEmbedController,
  SpotifyIFrameAPI,
  SpotifyPlaybackState,
} from 'util/spotifyPlayer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type EventListener = (event: { data?: SpotifyPlaybackState }) => void

const TRACK_URL = 'https://open.spotify.com/track/6vYTJP8tL8vBQzKpZ3gXrY'

function setup(apiLoaded = true) {
  const iframe = {
    allow: '',
    allowFullscreen: false,
    className: '',
    remove: vi.fn(),
    setAttribute: vi.fn(),
    src: '',
    title: '',
  }
  const script = {
    onerror: () => {},
    onload: () => {},
    remove: vi.fn(),
    src: '',
  }
  const listeners: Record<'playback_update' | 'ready', EventListener> = {
    playback_update: () => {},
    ready: () => {},
  }
  const controller: SpotifyEmbedController = {
    addListener: vi.fn(
      (event: 'playback_update' | 'ready', listener: EventListener) => {
        listeners[event] = listener
      },
    ),
    destroy: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    seek: vi.fn(),
  }
  const createController = vi.fn(
    (
      _iframe: HTMLIFrameElement,
      _options: { uri: string },
      callback: (created: SpotifyEmbedController) => void,
    ) => {
      callback(controller)
    },
  )
  const api: SpotifyIFrameAPI = { createController }
  const document = {
    createElement: vi.fn((tag: string) => (tag === 'iframe' ? iframe : script)),
    head: { append: vi.fn() },
  }
  const container = { append: vi.fn() }
  const callbacks = {
    onError: vi.fn(),
    onPlayingChange: vi.fn(),
    onProgress: vi.fn(),
  }

  vi.stubGlobal('document', document)
  vi.stubGlobal('onSpotifyIframeApiReady', vi.fn())
  vi.stubGlobal('SpotifyIframeApi', apiLoaded ? api : undefined)

  const host = globalThis as unknown as {
    onSpotifyIframeApiReady: (api?: SpotifyIFrameAPI) => void
    SpotifyIframeApi?: SpotifyIFrameAPI
  }

  return {
    api,
    callbacks,
    container: container as unknown as HTMLElement,
    controller,
    createController,
    document,
    host,
    iframe,
    listeners,
    script,
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('mountSpotifyPlayer', () => {
  it('keeps the embed credentialless and uses the canonical embed URL', async () => {
    const mock = setup()
    const { mountSpotifyPlayer } = await import('util/spotifyPlayer')
    const mounted = mountSpotifyPlayer(
      mock.container,
      TRACK_URL,
      mock.callbacks,
    )
    await Promise.resolve()

    expect(mock.container.append).toHaveBeenCalledWith(mock.iframe)
    expect(mock.iframe.setAttribute).toHaveBeenCalledWith('credentialless', '')
    expect(mock.iframe.src).toBe(
      'https://open.spotify.com/embed/track/6vYTJP8tL8vBQzKpZ3gXrY',
    )
    expect(mock.createController).toHaveBeenCalledWith(
      mock.iframe,
      { uri: 'spotify:track:6vYTJP8tL8vBQzKpZ3gXrY' },
      expect.any(Function),
    )
    mounted.destroy()
  })

  it('gates playback until the embed becomes ready', async () => {
    const mock = setup()
    const { mountSpotifyPlayer } = await import('util/spotifyPlayer')
    const mounted = mountSpotifyPlayer(
      mock.container,
      TRACK_URL,
      mock.callbacks,
    )
    await Promise.resolve()

    await mounted.media.play()
    expect(mock.controller.play).not.toHaveBeenCalled()
    expect(mounted.media.paused).toBe(false)

    mock.listeners.ready({})
    expect(mock.controller.play).toHaveBeenCalledOnce()

    mock.listeners.playback_update({
      data: { duration: 120000, isPaused: true, position: 0 },
    })
    expect(mounted.media.paused).toBe(true)
    mounted.destroy()
  })

  it('reports playback state from playback_update in seconds', async () => {
    const mock = setup()
    const { mountSpotifyPlayer } = await import('util/spotifyPlayer')
    const mounted = mountSpotifyPlayer(
      mock.container,
      TRACK_URL,
      mock.callbacks,
    )
    await Promise.resolve()
    mock.listeners.ready({})

    mock.listeners.playback_update({
      data: { duration: 120000, isPaused: false, position: 30000 },
    })
    expect(mounted.media.currentTime).toBe(30)
    expect(mounted.media.duration).toBe(120)
    expect(mounted.media.paused).toBe(false)
    expect(mock.callbacks.onProgress).toHaveBeenCalledWith(30, 120)
    expect(mock.callbacks.onPlayingChange).toHaveBeenLastCalledWith(true)

    mounted.media.currentTime = 60
    expect(mock.controller.seek).toHaveBeenCalledWith(60)
    mounted.media.pause()
    expect(mock.controller.pause).toHaveBeenCalledOnce()
    mounted.destroy()
  })

  it('ignores stale events after the player is destroyed', async () => {
    const mock = setup()
    const { mountSpotifyPlayer } = await import('util/spotifyPlayer')
    const mounted = mountSpotifyPlayer(
      mock.container,
      TRACK_URL,
      mock.callbacks,
    )
    await Promise.resolve()
    mounted.destroy()

    mock.listeners.ready({})
    mock.listeners.playback_update({
      data: { duration: 120000, isPaused: false, position: 30000 },
    })
    expect(mock.controller.destroy).toHaveBeenCalledOnce()
    expect(mock.iframe.remove).toHaveBeenCalledOnce()
    expect(mock.callbacks.onError).not.toHaveBeenCalled()
    expect(mock.callbacks.onPlayingChange).not.toHaveBeenCalled()
    expect(mock.callbacks.onProgress).not.toHaveBeenCalled()
  })

  it('falls back if the embed never becomes ready', async () => {
    const mock = setup()
    const { mountSpotifyPlayer } = await import('util/spotifyPlayer')
    const mounted = mountSpotifyPlayer(
      mock.container,
      TRACK_URL,
      mock.callbacks,
    )
    await Promise.resolve()

    vi.advanceTimersByTime(15_000)
    expect(mock.callbacks.onError).toHaveBeenCalledOnce()
    mounted.destroy()
    vi.advanceTimersByTime(15_000)
    expect(mock.callbacks.onError).toHaveBeenCalledOnce()
  })

  it('falls back when the iFrame API script cannot load', async () => {
    const mock = setup(false)
    const { mountSpotifyPlayer } = await import('util/spotifyPlayer')
    const mounted = mountSpotifyPlayer(
      mock.container,
      TRACK_URL,
      mock.callbacks,
    )

    mock.script.onerror()
    await vi.advanceTimersByTimeAsync(0)
    expect(mock.callbacks.onError).toHaveBeenCalledOnce()
    mounted.destroy()
  })

  it('falls back for a URL that is not embeddable', async () => {
    const mock = setup()
    const { mountSpotifyPlayer } = await import('util/spotifyPlayer')
    const mounted = mountSpotifyPlayer(
      mock.container,
      'https://open.spotify.com/artist/2wY73r2TofhR5yMgQ9pHqX',
      mock.callbacks,
    )

    expect(mock.callbacks.onError).toHaveBeenCalledOnce()
    expect(mock.createController).not.toHaveBeenCalled()
    mounted.destroy()
    expect(mock.iframe.remove).toHaveBeenCalledOnce()
  })
})

describe('loadSpotifyAPI', () => {
  it('shares API loading and preserves an existing ready callback', async () => {
    const mock = setup(false)
    const previousReady = mock.host.onSpotifyIframeApiReady
    const { loadSpotifyAPI } = await import('util/spotifyPlayer')
    const first = loadSpotifyAPI()
    const second = loadSpotifyAPI()
    expect(second).toBe(first)
    expect(mock.document.head.append).toHaveBeenCalledOnce()

    mock.host.SpotifyIframeApi = mock.api
    mock.host.onSpotifyIframeApiReady()
    await expect(first).resolves.toBe(mock.api)
    expect(previousReady).toHaveBeenCalledOnce()
    expect(mock.host.onSpotifyIframeApiReady).toBe(previousReady)
  })

  it('allows retry after a script load failure', async () => {
    const mock = setup(false)
    const { loadSpotifyAPI } = await import('util/spotifyPlayer')
    const first = loadSpotifyAPI()
    mock.script.onerror()
    await expect(first).rejects.toThrow('Failed to load Spotify iFrame API')

    const retry = loadSpotifyAPI()
    expect(retry).not.toBe(first)
    mock.host.SpotifyIframeApi = mock.api
    mock.host.onSpotifyIframeApiReady()
    await expect(retry).resolves.toBe(mock.api)
  })

  it('bounds initialization and clears the pending cache on timeout', async () => {
    const mock = setup(false)
    const { loadSpotifyAPI } = await import('util/spotifyPlayer')
    const first = loadSpotifyAPI()
    const failure = expect(first).rejects.toThrow(
      'Failed to load Spotify iFrame API',
    )
    vi.advanceTimersByTime(15_000)
    await failure
    expect(mock.script.remove).toHaveBeenCalledOnce()

    const retry = loadSpotifyAPI()
    expect(retry).not.toBe(first)
    mock.host.SpotifyIframeApi = mock.api
    mock.script.onload()
    await expect(retry).resolves.toBe(mock.api)
  })
})
