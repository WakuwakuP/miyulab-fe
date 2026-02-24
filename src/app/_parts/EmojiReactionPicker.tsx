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
import { EmojiContext } from 'util/provider/ResourceProvider'

const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false })

const PICKER_WIDTH = 350
const PICKER_HEIGHT = 450
const PICKER_MARGIN = 8

export const EmojiReactionPicker = ({
  onSelect,
  onClose,
  triggerRect,
}: {
  onSelect: (emoji: string) => void
  onClose: () => void
  triggerRect: DOMRect
}) => {
  const emojis = useContext(EmojiContext)
  const pickerRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number }>({
    left: 0,
    top: 0,
  })

  useEffect(() => {
    let top = triggerRect.top - PICKER_HEIGHT - PICKER_MARGIN
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
  }, [triggerRect])

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

  return createPortal(
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div
        className="fixed z-50"
        onClick={(e) => e.stopPropagation()}
        ref={pickerRef}
        style={{ left: position.left, top: position.top }}
      >
        <EmojiPicker
          allowExpandReactions
          customEmojis={customEmojis}
          emojiStyle={EmojiStyle.NATIVE}
          height={PICKER_HEIGHT}
          lazyLoadEmojis
          onEmojiClick={handleEmojiSelect}
          onReactionClick={handleEmojiSelect}
          reactionsDefaultOpen
          searchPlaceholder="Search emoji..."
          theme={Theme.DARK}
          width={PICKER_WIDTH}
        />
      </div>
    </>,
    document.body,
  )
}
