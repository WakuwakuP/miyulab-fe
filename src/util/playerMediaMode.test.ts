import {
  getPlayerControlCapabilities,
  getPlayerSizeTokens,
  isPlayableAttachmentType,
  resolvePlayerEmbedProvider,
  resolvePlayerMediaMode,
  shouldIgnorePlayerKeydownTarget,
} from 'util/playerMediaMode'
import { describe, expect, it } from 'vitest'

describe('isPlayableAttachmentType', () => {
  it('accepts audio/video/gifv', () => {
    expect(isPlayableAttachmentType('audio')).toBe(true)
    expect(isPlayableAttachmentType('video')).toBe(true)
    expect(isPlayableAttachmentType('gifv')).toBe(true)
  })

  it('rejects image and unknown', () => {
    expect(isPlayableAttachmentType('image')).toBe(false)
    expect(isPlayableAttachmentType('unknown')).toBe(false)
  })
})

describe('resolvePlayerMediaMode', () => {
  it('returns native for direct media URLs', () => {
    expect(
      resolvePlayerMediaMode({
        attachmentType: 'video',
        currentUrl: 'https://cdn.example.com/clip.mp4',
        externalEmbedFailed: false,
      }),
    ).toBe('native')
  })

  it('returns iframe for YouTube URLs when embed has not failed', () => {
    expect(
      resolvePlayerMediaMode({
        attachmentType: 'video',
        currentUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        externalEmbedFailed: false,
      }),
    ).toBe('iframe')
  })

  it('returns fallback for YouTube URLs when embed failed', () => {
    expect(
      resolvePlayerMediaMode({
        attachmentType: 'video',
        currentUrl: 'https://youtu.be/dQw4w9WgXcQ',
        externalEmbedFailed: true,
      }),
    ).toBe('fallback')
  })

  it('returns iframe for Spotify URLs when embed has not failed', () => {
    expect(
      resolvePlayerMediaMode({
        attachmentType: 'audio',
        currentUrl: 'https://open.spotify.com/episode/7nFzHqM1pYrVx0kLdE9sTf',
        externalEmbedFailed: false,
      }),
    ).toBe('iframe')
  })

  it('returns fallback for Spotify URLs when embed failed', () => {
    expect(
      resolvePlayerMediaMode({
        attachmentType: 'audio',
        currentUrl:
          'https://open.spotify.com/embed/track/6vYTJP8tL8vBQzKpZ3gXrY',
        externalEmbedFailed: true,
      }),
    ).toBe('fallback')
  })

  it('returns image for image attachments', () => {
    expect(
      resolvePlayerMediaMode({
        attachmentType: 'image',
        currentUrl: 'https://cdn.example.com/photo.jpg',
        externalEmbedFailed: false,
      }),
    ).toBe('image')
  })

  it('returns none for missing attachment or empty URL', () => {
    expect(
      resolvePlayerMediaMode({
        attachmentType: null,
        currentUrl: 'https://cdn.example.com/clip.mp4',
        externalEmbedFailed: false,
      }),
    ).toBe('none')
    expect(
      resolvePlayerMediaMode({
        attachmentType: 'video',
        currentUrl: '',
        externalEmbedFailed: false,
      }),
    ).toBe('none')
  })
})

describe('getPlayerControlCapabilities', () => {
  it('enables playback controls for native and API-controlled iframe modes', () => {
    for (const mode of ['native', 'iframe'] as const) {
      expect(getPlayerControlCapabilities(mode, 1)).toEqual({
        canClose: true,
        canPlayPause: true,
        canPrevNext: false,
        canSeek: true,
        canVolume: true,
      })
    }
  })

  it('disables playback/seek/volume for fallback and image', () => {
    for (const mode of ['fallback', 'image'] as const) {
      expect(getPlayerControlCapabilities(mode, 1)).toEqual({
        canClose: true,
        canPlayPause: false,
        canPrevNext: false,
        canSeek: false,
        canVolume: false,
      })
    }
  })

  it('enables prev/next when multiple tracks exist', () => {
    expect(getPlayerControlCapabilities('iframe', 3).canPrevNext).toBe(true)
    expect(getPlayerControlCapabilities('fallback', 2).canPrevNext).toBe(true)
    expect(getPlayerControlCapabilities('native', 2).canPrevNext).toBe(true)
    expect(getPlayerControlCapabilities('none', 2).canPrevNext).toBe(false)
  })

  it('does not enable seek on fallback (regression for #649)', () => {
    expect(getPlayerControlCapabilities('fallback', 1).canSeek).toBe(false)
  })

  it('disables volume only for Spotify, whose iFrame API has no volume', () => {
    expect(getPlayerControlCapabilities('iframe', 1, 'spotify').canVolume).toBe(
      false,
    )
    expect(getPlayerControlCapabilities('iframe', 1, 'youtube').canVolume).toBe(
      true,
    )
    expect(
      getPlayerControlCapabilities('fallback', 1, 'spotify').canVolume,
    ).toBe(false)
    expect(getPlayerControlCapabilities('iframe', 1, 'youtube').canVolume).toBe(
      true,
    )
    expect(getPlayerControlCapabilities('native', 1).canVolume).toBe(true)
  })
})

describe('resolvePlayerEmbedProvider', () => {
  it('maps embeddable URLs to their credentialless provider', () => {
    expect(
      resolvePlayerEmbedProvider(
        'https://open.spotify.com/track/6vYTJP8tL8vBQzKpZ3gXrY',
      ),
    ).toBe('spotify')
    expect(resolvePlayerEmbedProvider('https://youtu.be/-2pJ1dyzEE0')).toBe(
      'youtube',
    )
  })

  it('returns null for direct media', () => {
    expect(
      resolvePlayerEmbedProvider('https://cdn.example.com/clip.mp4'),
    ).toBeNull()
  })
})

describe('getPlayerSizeTokens', () => {
  it('returns matching Tailwind classes and pixel heights', () => {
    expect(getPlayerSizeTokens('small')).toEqual({
      hClass: 'h-[180px]',
      hPx: '180px',
      wClass: 'w-[320px]',
    })
    expect(getPlayerSizeTokens('medium').hPx).toBe('360px')
    expect(getPlayerSizeTokens('large').hPx).toBe('460px')
  })
})

describe('shouldIgnorePlayerKeydownTarget', () => {
  it('ignores null / non-Node targets', () => {
    expect(shouldIgnorePlayerKeydownTarget(null)).toBe(true)
    expect(shouldIgnorePlayerKeydownTarget({} as EventTarget)).toBe(true)
  })
})
