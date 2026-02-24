'use client'

import { EmojiStyle, Theme } from 'emoji-picker-react'
import dynamic from 'next/dynamic'
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { RiAddLine } from 'react-icons/ri'
import { EmojiContext } from 'util/provider/ResourceProvider'

const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false })

const PICKER_WIDTH = 350
const PICKER_HEIGHT = 450
const PICKER_MARGIN = 8
const COMPACT_BAR_HEIGHT = 50

export const EmojiReactionPicker = ({
  onSelect,
  onClose,
  triggerRect,
  reactions,
}: {
  onSelect: (emoji: string) => void
  onClose: () => void
  triggerRect: DOMRect
  reactions?: string[]
}) => {
  const emojis = useContext(EmojiContext)
  const pickerRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number }>({
    left: 0,
    top: 0,
  })

  const currentHeight = expanded ? PICKER_HEIGHT : COMPACT_BAR_HEIGHT

  useEffect(() => {
    let top = triggerRect.top - currentHeight - PICKER_MARGIN
    if (top < PICKER_MARGIN) {
      top = triggerRect.bottom + PICKER_MARGIN
    }

    let left = triggerRect.left + triggerRect.width / 2 - PICKER_WIDTH / 2
    if (left < PICKER_MARGIN) {
      left = PICKER_MARGIN
    } else if (left + PICKER_WIDTH > window.innerWidth - PICKER_MARGIN) {
      left = window.innerWidth - PICKER_WIDTH - PICKER_MARGIN
    }

    setPosition({ left, top })
  }, [triggerRect, currentHeight])

  const customEmojis = useMemo(
    () =>
      emojis
        .filter((e) => e.url !== '')
        .map((e) => ({
          id: e.shortcode,
          imgUrl: e.url,
          names: [e.shortcode],
        })),
    [emojis],
  )

  const emojiUrlMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of emojis) {
      map.set(e.shortcode, e.url)
    }
    return map
  }, [emojis])

  const handleEmojiSelect = useCallback(
    (emojiData: { isCustom: boolean; emoji: string }) => {
      if (emojiData.isCustom) {
        onSelect(`:${emojiData.emoji}:`)
      } else {
        onSelect(emojiData.emoji)
      }
    },
    [onSelect],
  )

  const handleCompactSelect = useCallback(
    (emoji: string) => {
      onSelect(emoji)
    },
    [onSelect],
  )

  return createPortal(
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div
        className="fixed z-50"
        onClick={(e) => e.stopPropagation()}
        ref={pickerRef}
        style={{ left: position.left, top: position.top }}
      >
        {expanded ? (
          <EmojiPicker
            customEmojis={customEmojis}
            emojiStyle={EmojiStyle.NATIVE}
            height={PICKER_HEIGHT}
            lazyLoadEmojis
            onEmojiClick={handleEmojiSelect}
            searchPlaceholder="Search emoji..."
            skinTonesDisabled
            theme={Theme.DARK}
            width={PICKER_WIDTH}
          />
        ) : (
          <div
            className="flex items-center gap-1 rounded-lg bg-[#222] p-2"
            style={{ width: PICKER_WIDTH }}
          >
            <div className="flex flex-1 items-center gap-1 overflow-x-auto">
              {reactions?.map((emoji) => {
                const isCustom =
                  emoji.startsWith(':') &&
                  emoji.endsWith(':') &&
                  emoji.length > 2
                const shortcode = isCustom ? emoji.slice(1, -1) : null
                const url = shortcode ? emojiUrlMap.get(shortcode) : null
                return (
                  <button
                    className="flex-shrink-0 rounded p-1 text-xl hover:bg-gray-700"
                    key={emoji}
                    onClick={() => handleCompactSelect(emoji)}
                    type="button"
                  >
                    {isCustom && url ? (
                      <img
                        alt={shortcode ?? ''}
                        className="inline-block h-6 w-6"
                        src={url}
                      />
                    ) : (
                      emoji
                    )}
                  </button>
                )
              })}
            </div>
            <button
              className="flex-shrink-0 rounded p-1 text-lg text-gray-400 hover:bg-gray-700 hover:text-white"
              onClick={() => setExpanded(true)}
              type="button"
            >
              <RiAddLine size={20} />
            </button>
          </div>
        )}
      </div>
    </>,
    document.body,
  )
}
