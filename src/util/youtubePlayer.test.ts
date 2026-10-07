import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type PlayerEvents = {
  onAutoplayBlocked: () => void
  onError: () => void
  onReady: () => void
  onStateChange: (event: { data: number }) => void
}

const VIDEO_URL = 'https://youtu.be/-2pJ1dyzEE0'

function setup(apiLoaded = true) {
  const iframe = {
    remove: vi.fn(),
    setAttribute: vi.fn(),
    src: '',
  }
  const script = { onerror: () => {}, remove: vi.fn(), src: '' }
  const apiPlayer = {
    destroy: vi.fn(),
    getCurrentTime: vi.fn(() => 30),
    getDuration: vi.fn(() => 120),
    pauseVideo: vi.fn(),
    playVideo: vi.fn(),
    seekTo: vi.fn(),
    setVolume: vi.fn(),
  }
  let events: PlayerEvents
  // biome-ignore lint/complexity/useArrowFunction: This mock is invoked as a constructor.
  const Player = vi.fn(function (
    _iframe: HTMLIFrameElement,
    options: { events: PlayerEvents },
  ) {
    events = options.events
    return apiPlayer
  })
  const host = {
    location: { origin: 'https://miyulab.example' },
    onYouTubeIframeAPIReady: vi.fn(),
    YT: apiLoaded ? { Player } : undefined,
  }
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
  vi.stubGlobal('window', host)
  vi.stubGlobal('document', document)
  return {
    apiPlayer,
    callbacks,
    container: container as unknown as HTMLElement,
    document,
    get events() {
      return events
    },
    host,
    iframe,
    Player,
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

describe('mountYouTubePlayer', () => {
  it('keeps the API-enabled embed credentialless with the parent origin', async () => {
    const mock = setup()
    const { mountYouTubePlayer } = await import('util/youtubePlayer')
    const mounted = mountYouTubePlayer(
      mock.container,
      VIDEO_URL,
      mock.callbacks,
    )
    await Promise.resolve()

    expect(mock.iframe.setAttribute).toHaveBeenCalledWith('credentialless', '')
    const src = new URL(mock.iframe.src)
    expect(src.origin).toBe('https://www.youtube-nocookie.com')
    expect(src.pathname).toBe('/embed/-2pJ1dyzEE0')
    expect(src.searchParams.get('enablejsapi')).toBe('1')
    expect(src.searchParams.get('origin')).toBe('https://miyulab.example')
    expect(mock.Player).toHaveBeenCalledWith(mock.iframe, expect.any(Object))
    mounted.destroy()
  })

  it('applies the latest volume and playback request once ready', async () => {
    const mock = setup()
    const { mountYouTubePlayer } = await import('util/youtubePlayer')
    const mounted = mountYouTubePlayer(
      mock.container,
      VIDEO_URL,
      mock.callbacks,
    )
    mounted.setVolume(0.42)
    await mounted.media.play()
    mounted.setVolume(0.23)
    expect(mock.apiPlayer.setVolume).not.toHaveBeenCalled()
    expect(mock.apiPlayer.playVideo).not.toHaveBeenCalled()

    mock.events.onReady()
    expect(mock.apiPlayer.setVolume).toHaveBeenLastCalledWith(23)
    expect(mock.apiPlayer.playVideo).toHaveBeenCalledOnce()
    mounted.setVolume(0.55)
    expect(mock.apiPlayer.setVolume).toHaveBeenLastCalledWith(55)
    mounted.media.pause()
    expect(mock.apiPlayer.pauseVideo).toHaveBeenCalledOnce()
    expect(mounted.media.paused).toBe(true)
    mounted.destroy()
  })

  it('exposes seconds-based seeking and reports progress to the component', async () => {
    const mock = setup()
    const { mountYouTubePlayer } = await import('util/youtubePlayer')
    const mounted = mountYouTubePlayer(
      mock.container,
      VIDEO_URL,
      mock.callbacks,
    )
    await Promise.resolve()
    expect(mounted.media.duration).toBe(0)
    mock.events.onReady()

    mounted.media.currentTime = mounted.media.duration * 0.5
    expect(mock.apiPlayer.seekTo).toHaveBeenCalledWith(60, true)
    vi.advanceTimersByTime(250)
    expect(mock.callbacks.onProgress).toHaveBeenCalledWith(30, 120)
    mounted.destroy()
    vi.advanceTimersByTime(1000)
    expect(mock.callbacks.onProgress).toHaveBeenCalledOnce()
    expect(mock.apiPlayer.destroy).toHaveBeenCalledOnce()
    expect(mock.iframe.remove).toHaveBeenCalledOnce()
  })

  it('syncs embedded playback state and loops when playback ends', async () => {
    const mock = setup()
    const { mountYouTubePlayer } = await import('util/youtubePlayer')
    const mounted = mountYouTubePlayer(
      mock.container,
      VIDEO_URL,
      mock.callbacks,
    )
    await Promise.resolve()
    mock.events.onReady()
    mock.events.onStateChange({ data: 1 })
    expect(mounted.media.paused).toBe(false)
    expect(mock.callbacks.onPlayingChange).toHaveBeenLastCalledWith(true)
    mock.events.onStateChange({ data: 2 })
    expect(mock.callbacks.onPlayingChange).toHaveBeenLastCalledWith(false)
    mock.events.onStateChange({ data: 0 })
    expect(mock.apiPlayer.seekTo).toHaveBeenCalledWith(0, true)
    expect(mock.apiPlayer.playVideo).toHaveBeenCalledOnce()
    mounted.destroy()
  })

  it('falls back on embed errors and ignores stale events after track removal', async () => {
    const mock = setup()
    const { mountYouTubePlayer } = await import('util/youtubePlayer')
    const mounted = mountYouTubePlayer(
      mock.container,
      VIDEO_URL,
      mock.callbacks,
    )
    await Promise.resolve()
    mock.events.onError()
    expect(mock.callbacks.onError).toHaveBeenCalledOnce()
    mounted.destroy()
    mock.events.onReady()
    mock.events.onStateChange({ data: 1 })
    mock.events.onError()
    vi.advanceTimersByTime(1000)
    expect(mock.callbacks.onError).toHaveBeenCalledOnce()
    expect(mock.callbacks.onPlayingChange).not.toHaveBeenCalled()
    expect(mock.callbacks.onProgress).not.toHaveBeenCalled()
  })

  it('does not create a player if removed while the API is loading', async () => {
    const mock = setup(false)
    const { mountYouTubePlayer } = await import('util/youtubePlayer')
    const mounted = mountYouTubePlayer(
      mock.container,
      VIDEO_URL,
      mock.callbacks,
    )
    mounted.destroy()
    mock.host.YT = { Player: mock.Player }
    mock.host.onYouTubeIframeAPIReady()
    await Promise.resolve()
    expect(mock.Player).not.toHaveBeenCalled()
    expect(mock.callbacks.onError).not.toHaveBeenCalled()
  })

  it('falls back if the iframe never becomes ready', async () => {
    const mock = setup()
    const { mountYouTubePlayer } = await import('util/youtubePlayer')
    const mounted = mountYouTubePlayer(
      mock.container,
      VIDEO_URL,
      mock.callbacks,
    )
    await Promise.resolve()
    vi.advanceTimersByTime(15_000)
    expect(mock.callbacks.onError).toHaveBeenCalledOnce()
    mounted.destroy()
  })

  it('resets playback state when the browser blocks playback', async () => {
    const mock = setup()
    const { mountYouTubePlayer } = await import('util/youtubePlayer')
    const mounted = mountYouTubePlayer(
      mock.container,
      VIDEO_URL,
      mock.callbacks,
    )
    await Promise.resolve()
    mock.events.onReady()
    await mounted.media.play()
    mock.events.onAutoplayBlocked()
    expect(mounted.media.paused).toBe(true)
    expect(mock.callbacks.onPlayingChange).toHaveBeenCalledWith(false)
    mounted.destroy()
  })
})

describe('loadYouTubeAPI', () => {
  it('shares API loading and preserves an existing ready callback', async () => {
    const mock = setup(false)
    const previousReady = mock.host.onYouTubeIframeAPIReady
    const { loadYouTubeAPI } = await import('util/youtubePlayer')
    const first = loadYouTubeAPI()
    const second = loadYouTubeAPI()
    expect(second).toBe(first)
    expect(mock.document.head.append).toHaveBeenCalledOnce()
    mock.host.YT = { Player: mock.Player }
    mock.host.onYouTubeIframeAPIReady()
    await expect(first).resolves.toBe(mock.host.YT)
    expect(previousReady).toHaveBeenCalledOnce()
  })

  it('allows retry after a script load failure', async () => {
    const mock = setup(false)
    const { loadYouTubeAPI } = await import('util/youtubePlayer')
    const first = loadYouTubeAPI()
    mock.script.onerror()
    await expect(first).rejects.toThrow('Failed to load YouTube IFrame API')
    const retry = loadYouTubeAPI()
    mock.host.YT = { Player: mock.Player }
    mock.host.onYouTubeIframeAPIReady()
    await expect(retry).resolves.toBe(mock.host.YT)
  })

  it('bounds secondary-script initialization and clears the pending cache', async () => {
    const mock = setup(false)
    const { loadYouTubeAPI } = await import('util/youtubePlayer')
    const first = loadYouTubeAPI()
    const failure = expect(first).rejects.toThrow('Failed to load')
    // The outer script loaded, but its secondary script never completed.
    vi.advanceTimersByTime(15_000)
    await failure
    expect(mock.script.remove).toHaveBeenCalledOnce()
    const retry = loadYouTubeAPI()
    expect(retry).not.toBe(first)
    mock.host.YT = { Player: mock.Player }
    mock.host.onYouTubeIframeAPIReady()
    await expect(retry).resolves.toBe(mock.host.YT)
  })
})
