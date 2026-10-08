import { Player } from 'app/_components/Player'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlayerContext } from 'util/provider/PlayerProvider'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('react-dom', () => ({
  createPortal: (children: ReactNode) => children,
}))

afterEach(() => vi.unstubAllGlobals())

it('enables the component controls for YouTube playback', () => {
  vi.stubGlobal('document', { body: null })

  const html = renderToStaticMarkup(
    createElement(
      PlayerContext.Provider,
      {
        value: {
          attachment: [
            {
              blurhash: null,
              description: '',
              id: '',
              meta: null,
              preview_url: null,
              remote_url: null,
              text_url: null,
              type: 'video',
              url: 'https://www.youtube.com/watch?v=-2pJ1dyzEE0',
            },
          ],
          index: 0,
        },
      },
      createElement(Player),
    ),
  )

  expect(html).toContain('aria-label="Play media"')
  expect(html).toContain('aria-label="Seek media"')
  expect(html).toContain('aria-label="Media volume"')
  expect(html).not.toContain('disabled=""')
  expect(html).not.toContain('Use the embedded player controls')
})

it('enables the volume control for Spotify previews', () => {
  vi.stubGlobal('document', { body: null })

  const html = renderToStaticMarkup(
    createElement(
      PlayerContext.Provider,
      {
        value: {
          attachment: [
            {
              blurhash: null,
              description: '',
              id: '',
              meta: null,
              preview_url: null,
              remote_url: null,
              text_url: null,
              type: 'audio',
              url: 'https://open.spotify.com/track/1vpbLnUhfINQDr1Z8A0cPp',
            },
          ],
          index: 0,
        },
      },
      createElement(Player),
    ),
  )

  expect(html).toContain('aria-label="Play media"')
  expect(html).toContain('aria-label="Seek media"')
  expect(html).toContain('aria-label="Media volume"')
  expect(html).not.toContain('disabled=""')
  expect(html).not.toContain('Use the embedded player controls')
})
