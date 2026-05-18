import type { ReactNode } from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { NotificationAddAppIndex } from 'types/types'
import { describe, expect, it, vi } from 'vitest'

vi.mock('util/provider/AppsProvider', async () => {
  const { createContext } = await import('react')
  return { AppsContext: createContext([]) }
})

vi.mock('util/provider/DetailProvider', async () => {
  const { createContext } = await import('react')
  return { SetDetailContext: createContext(() => {}) }
})

vi.mock('util/provider/ResourceProvider', async () => {
  const { createContext } = await import('react')
  return {
    EmojiCatalogContext: createContext(new Map()),
    EmojiContext: createContext([]),
  }
})

vi.mock('app/_parts/Status', () => ({
  Status: () => null,
}))

import { AppsContext } from 'util/provider/AppsProvider'
import { SetDetailContext } from 'util/provider/DetailProvider'
import {
  EmojiCatalogContext,
  EmojiContext,
} from 'util/provider/ResourceProvider'

import { Notification } from '../Notification'

const withNotificationProviders = (children: ReactNode) =>
  createElement(
    AppsContext.Provider,
    {
      value: [
        {
          backendUrl: 'https://example.com',
        },
      ],
    },
    createElement(
      EmojiCatalogContext.Provider,
      { value: new Map() },
      createElement(
        EmojiContext.Provider,
        { value: [] },
        createElement(SetDetailContext.Provider, { value: () => {} }, children),
      ),
    ),
  )

describe('Notification', () => {
  it('renders emoji reaction images with explicit dimensions', () => {
    const notification = {
      account: {
        acct: 'alice',
        avatar: 'https://example.com/avatar.png',
        display_name: 'Alice',
        emojis: [],
      },
      appIndex: 0,
      reaction: {
        name: ':blobcat:',
        static_url: 'https://example.com/emoji/blobcat.png',
        url: 'https://example.com/emoji/blobcat.png',
      },
      status: null,
      type: 'emoji_reaction',
    } as unknown as NotificationAddAppIndex

    expect(() =>
      renderToStaticMarkup(
        withNotificationProviders(
          createElement(Notification, {
            notification,
            scrolling: false,
          }),
        ),
      ),
    ).not.toThrow()
  })
})
