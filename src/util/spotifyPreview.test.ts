import { parseSpotifyPreview } from 'util/spotifyPreview'
import { describe, expect, it } from 'vitest'

const previewUrl = 'https://p.scdn.co/mp3-preview/abcdef1234'
const html = (entity: unknown) =>
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })}</script>`

describe('parseSpotifyPreview', () => {
  it('reads the public preview for a single track', () => {
    expect(
      parseSpotifyPreview(
        html({
          audioPreview: { url: previewUrl },
          name: 'Spring for you - Instrumental',
        }),
      ),
    ).toEqual({
      title: 'Spring for you - Instrumental',
      tracks: [
        {
          subtitle: '',
          title: 'Spring for you - Instrumental',
          url: previewUrl,
        },
      ],
    })
  })

  it('keeps playlist order and skips tracks without public previews', () => {
    expect(
      parseSpotifyPreview(
        html({
          name: 'Playlist',
          trackList: [
            {
              audioPreview: { url: previewUrl },
              subtitle: 'Artist',
              title: 'First',
            },
            { audioPreview: null, title: 'Unavailable' },
            { audioPreview: { url: `${previewUrl}?cid=123` }, title: 'Second' },
          ],
        }),
      ),
    ).toEqual({
      title: 'Playlist',
      tracks: [
        { subtitle: 'Artist', title: 'First', url: previewUrl },
        { subtitle: '', title: 'Second', url: `${previewUrl}?cid=123` },
      ],
    })
  })

  it.each([
    'https://p.scdn.co.evil.test/mp3-preview/abcdef',
    'https://p.scdn.co@evil.test/mp3-preview/abcdef',
    'http://p.scdn.co/mp3-preview/abcdef',
    'https://p.scdn.co/other/abcdef',
    'javascript:alert(1)',
  ])('rejects audio outside the fixed HTTPS preview CDN: %s', (url) => {
    expect(() =>
      parseSpotifyPreview(html({ audioPreview: { url }, name: 'Track' })),
    ).toThrow('No playable Spotify previews')
  })

  it.each([
    null,
    {},
    { name: 123 },
    { name: 'Empty', trackList: [] },
    {
      name: 'Malformed',
      trackList: [null, 5, { audioPreview: { url: previewUrl } }],
    },
  ])('fails closed on missing or malformed metadata: %j', (entity) => {
    expect(() => parseSpotifyPreview(html(entity))).toThrow()
  })

  it('rejects missing or invalid JSON', () => {
    expect(() => parseSpotifyPreview('<html></html>')).toThrow()
    expect(() =>
      parseSpotifyPreview('<script id="__NEXT_DATA__">{</script>'),
    ).toThrow()
  })
})
