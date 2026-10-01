import { Player } from 'app/_components/Player'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlayerContext } from 'util/provider/PlayerProvider'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('react-dom', () => ({
  createPortal: (children: ReactNode) => children,
}))

afterEach(() => vi.unstubAllGlobals())

it('keeps the YouTube iframe credentialless so COEP allows it to load', () => {
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

  expect(html).toContain(
    'src="https://www.youtube-nocookie.com/embed/-2pJ1dyzEE0"',
  )
  expect(html).toContain('credentialless=""')
})
