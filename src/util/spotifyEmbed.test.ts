import {
  extractSpotifyEmbedTarget,
  getSpotifyEmbedUrl,
  getSpotifyUri,
  isSpotifyUrl,
} from 'util/spotifyEmbed'
import { describe, expect, it } from 'vitest'

describe('extractSpotifyEmbedTarget', () => {
  it('accepts page URLs', () => {
    expect(
      extractSpotifyEmbedTarget(
        'https://open.spotify.com/track/6vYTJP8tL8vBQzKpZ3gXrY',
      ),
    ).toEqual({ id: '6vYTJP8tL8vBQzKpZ3gXrY', type: 'track' })
    expect(
      extractSpotifyEmbedTarget(
        'https://open.spotify.com/episode/7nFzHqM1pYrVx0kLdE9sTf',
      ),
    ).toEqual({ id: '7nFzHqM1pYrVx0kLdE9sTf', type: 'episode' })
  })

  it('accepts embed URLs and normalizes the type', () => {
    expect(
      extractSpotifyEmbedTarget(
        'https://open.spotify.com/embed/album/4mVYFz8oQ0kLdE9sTf',
      ),
    ).toEqual({ id: '4mVYFz8oQ0kLdE9sTf', type: 'album' })
    expect(
      extractSpotifyEmbedTarget('https://play.spotify.com/Track/abc123'),
    ).toEqual({ id: 'abc123', type: 'track' })
  })

  it('rejects other hosts and missing ids', () => {
    expect(
      extractSpotifyEmbedTarget('https://example.com/track/abc123'),
    ).toBeNull()
    expect(
      extractSpotifyEmbedTarget('https://open.spotify.com/track'),
    ).toBeNull()
    expect(
      extractSpotifyEmbedTarget('open.spotify.com/track/abc123'),
    ).toBeNull()
  })

  it('rejects unsupported types and unsafe ids', () => {
    expect(
      extractSpotifyEmbedTarget('https://open.spotify.com/user/abc123'),
    ).toBeNull()
    expect(
      extractSpotifyEmbedTarget('https://open.spotify.com/track/abc!def'),
    ).toBeNull()
  })
})

describe('isSpotifyUrl', () => {
  it('only reports embeddable Spotify links as playable', () => {
    expect(
      isSpotifyUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'),
    ).toBe(true)
    expect(
      isSpotifyUrl('https://open.spotify.com/artist/2wY73r2TofhR5yMgQ9pHqX'),
    ).toBe(false)
  })
})

describe('getSpotifyEmbedUrl', () => {
  it('always returns the canonical embed URL without query params', () => {
    expect(
      getSpotifyEmbedUrl(
        'https://open.spotify.com/episode/7nFzHqM1pYrVx0kLdE9sTf?si=abc&t=0',
      ),
    ).toBe('https://open.spotify.com/embed/episode/7nFzHqM1pYrVx0kLdE9sTf')
    expect(
      getSpotifyEmbedUrl('https://play.spotify.com/embed/track/abc123'),
    ).toBe('https://open.spotify.com/embed/track/abc123')
    expect(getSpotifyEmbedUrl('https://example.com/track/abc123')).toBeNull()
  })
})

describe('getSpotifyUri', () => {
  it('builds the spotify:type:id URI for the iFrame API', () => {
    expect(
      getSpotifyUri('https://open.spotify.com/show/3NHszYaq3xzwZfxGbQgM8T'),
    ).toBe('spotify:show:3NHszYaq3xzwZfxGbQgM8T')
    expect(
      getSpotifyUri('https://notspotify.com/embed/track/abc123'),
    ).toBeNull()
  })
})
