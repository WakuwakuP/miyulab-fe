/* eslint-disable @next/next/no-img-element */
'use client'

import type { Entity } from 'megalodon'
import * as Emoji from 'node-emoji'
import { useContext, useMemo, useRef, useState } from 'react'
import { EmojiContext } from 'util/provider/ResourceProvider'

const QUICK_REACTIONS = ['👍', '❤️', '😆', '🎉', '😮', '😢', '😡', '👀']
const MAX_DISPLAY = 48

export const EmojiReactionPicker = ({
  onSelect,
}: {
  onSelect: (emoji: string) => void
}) => {
  const emojis = useContext(EmojiContext)
  const [search, setSearch] = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)

  const customEmojis = useMemo(
    () => emojis.filter((e) => e.url !== ''),
    [emojis],
  )

  const filteredCustomEmojis = useMemo(() => {
    if (search === '') return customEmojis.slice(0, MAX_DISPLAY)
    return customEmojis
      .filter((e) =>
        e.shortcode.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
      )
      .slice(0, MAX_DISPLAY)
  }, [customEmojis, search])

  const filteredUnicodeEmojis = useMemo(() => {
    if (search === '') return []
    return emojis
      .filter(
        (e) =>
          e.url === '' &&
          e.shortcode.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
      )
      .slice(0, MAX_DISPLAY)
  }, [emojis, search])

  const handleSelect = (emoji: Entity.Emoji) => {
    if (emoji.url !== '') {
      onSelect(`:${emoji.shortcode}:`)
    } else {
      const emojiChar = Emoji.get(emoji.shortcode)
      if (emojiChar && !emojiChar.startsWith(':')) {
        onSelect(emojiChar)
      }
    }
  }

  return (
    <div
      className="absolute bottom-full right-0 z-50 mb-1 w-72 rounded-md border border-gray-600 bg-gray-800 p-2 shadow-lg"
      onClick={(e) => e.stopPropagation()}
      ref={pickerRef}
    >
      <div className="flex flex-wrap gap-1 border-b border-gray-600 pb-2">
        {QUICK_REACTIONS.map((emoji) => (
          <button
            className="rounded p-1 text-xl hover:bg-gray-700"
            key={emoji}
            onClick={() => onSelect(emoji)}
            type="button"
          >
            {emoji}
          </button>
        ))}
      </div>

      <input
        className="mt-2 w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm"
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search emoji..."
        type="text"
        value={search}
      />

      <div className="mt-2 max-h-48 overflow-y-auto">
        {filteredCustomEmojis.length > 0 && (
          <div>
            <p className="pb-1 text-xs text-gray-400">Custom</p>
            <div className="flex flex-wrap gap-1">
              {filteredCustomEmojis.map((emoji) => (
                <button
                  className="rounded p-1 hover:bg-gray-700"
                  key={emoji.shortcode}
                  onClick={() => handleSelect(emoji)}
                  title={`:${emoji.shortcode}:`}
                  type="button"
                >
                  <img
                    alt={emoji.shortcode}
                    className="h-7 w-7 object-contain"
                    loading="lazy"
                    src={emoji.url}
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {filteredUnicodeEmojis.length > 0 && (
          <div className="mt-2">
            <p className="pb-1 text-xs text-gray-400">Emoji</p>
            <div className="flex flex-wrap gap-1">
              {filteredUnicodeEmojis.map((emoji) => (
                <button
                  className="rounded p-1 text-xl hover:bg-gray-700"
                  key={emoji.shortcode}
                  onClick={() => handleSelect(emoji)}
                  title={`:${emoji.shortcode}:`}
                  type="button"
                >
                  {Emoji.get(emoji.shortcode)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
