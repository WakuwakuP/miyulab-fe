import { GET } from 'app/api/spotify-preview/route'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())
const request = (url: string) =>
  new Request(
    `https://app.test/api/spotify-preview?url=${encodeURIComponent(url)}`,
  )

it.each([
  'https://evil.test/track/abc',
  'https://open.spotify.com.evil.test/track/abc',
  'https://open.spotify.com/track/abc!def',
  'a'.repeat(513),
  '',
])('rejects invalid inputs without fetching: %s', async (url) => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  expect((await GET(request(url))).status).toBe(400)
  expect(fetch).not.toHaveBeenCalled()
})

it('fetches only a canonical Spotify embed and returns minimal public metadata', async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      `<script id="__NEXT_DATA__">${JSON.stringify({
        props: {
          pageProps: {
            state: {
              data: {
                entity: {
                  audioPreview: { url: 'https://p.scdn.co/mp3-preview/abcdef' },
                  name: 'Track',
                },
              },
            },
          },
        },
      })}</script>`,
    ),
  )
  vi.stubGlobal('fetch', fetch)
  const response = await GET(
    request(
      'http://user:pass@play.spotify.com:8080/track/abc?anything=ignored',
    ),
  )
  expect(fetch).toHaveBeenCalledWith(
    'https://open.spotify.com/embed/track/abc',
    expect.objectContaining({
      redirect: 'error',
      signal: expect.any(AbortSignal),
    }),
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    title: 'Track',
    tracks: [
      {
        subtitle: '',
        title: 'Track',
        url: 'https://p.scdn.co/mp3-preview/abcdef',
      },
    ],
  })
})

it.each([
  new Response('', { status: 404 }),
  new Response('<html>No embed data</html>'),
  new Response('a'.repeat(4_000_001)),
])(
  'reports unavailable previews without leaking the upstream body',
  async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    const result = await GET(request('https://open.spotify.com/track/abc'))
    expect(result.status).toBe(502)
    expect(await result.json()).toEqual({
      error: 'Spotify preview is unavailable',
    })
  },
)

it('handles network errors and timeouts', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('upstream detail')),
  )
  const response = await GET(request('https://open.spotify.com/track/abc'))
  expect(response.status).toBe(502)
  expect(await response.json()).toEqual({
    error: 'Spotify preview is unavailable',
  })
})
