/* eslint-disable @next/next/no-img-element */
'use client'

import {
  CSSProperties,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'

import { Entity } from 'megalodon'
import * as Emoji from 'node-emoji'
import { createPortal } from 'react-dom'
import {
  RichTextarea,
  RichTextareaHandle,
  createRegexRenderer,
} from 'rich-textarea'

import { EmojiContext } from 'util/provider/ResourceProvider'

const CHARACTERS = [
  'user1',
  'user2',
  'user3',
  'user4',
  'user5',
]

const MAX_LIST_LENGTH = 8
const MENTION_REG = /@([+\w]*)$/
const EMOJI_REG = /:([+\w]*)$/

const MENTION_HIGHLIGHT_REG = new RegExp(
  `(${CHARACTERS.map((c) => `@${c}`).join('|')})`,
  'g'
)

const EmojiMenu = ({
  chars,
  index,
  top,
  left,
  complete,
}: {
  chars: Entity.Emoji[]
  index: number
  top: number
  left: number
  complete: (index: number) => void
}) => {
  return (
    <div
      style={{
        position: 'fixed',
        top: top,
        left: left,
        backgroundColor: 'white',
        color: 'black',
        border: '1px solid black',
      }}
    >
      {chars.map((char, i) => (
        <div
          key={char.shortcode}
          style={{
            display: 'flex',
            padding: '4px',
            ...(index === i && {
              color: 'white',
              backgroundColor: 'blue',
            }),
          }}
          onMouseDown={(e) => {
            e.preventDefault()
            complete(i)
          }}
        >
          {char.url === '' ? (
            <div>
              {Emoji.emojify(`:${char.shortcode}:`)}
            </div>
          ) : (
            <img
              src={char.url}
              alt={char.shortcode}
              className="mr-1 h-6 w-6"
            />
          )}
          <div>:{char.shortcode}:</div>
        </div>
      ))}
    </div>
  )
}

const Menu = ({
  chars,
  index,
  top,
  left,
  complete,
}: {
  chars: string[]
  index: number
  top: number
  left: number
  complete: (index: number) => void
}) => {
  return (
    <div
      style={{
        position: 'fixed',
        top: top,
        left: left,
        backgroundColor: 'white',
        color: 'black',
        border: '1px solid black',
      }}
    >
      {chars.map((char, i) => (
        <div
          key={char}
          style={{
            padding: '4px',
            ...(index === i && {
              color: 'white',
              backgroundColor: 'blue',
            }),
          }}
          onMouseDown={(e) => {
            e.preventDefault()
            complete(i)
          }}
        >
          {char}
        </div>
      ))}
    </div>
  )
}

export const StatusRichTextarea = ({
  text,
  placeholder = '',
  onChange,
  style,
}: {
  text: string
  placeholder?: string
  onChange: (text: string) => void
  style: CSSProperties
}) => {
  const emojis = useContext(EmojiContext)
  const ref = useRef<RichTextareaHandle>(null)

  const [pos, setPos] = useState<{
    top: number
    left: number
    caret: number
  } | null>(null)

  const [index, setIndex] = useState<number>(0)

  const [isMention, setIsMention] = useState(false)
  const [isEmoji, setIsEmoji] = useState(false)

  const targetText =
    pos != null ? text.slice(0, pos.caret) : text

  const mentionMatch =
    pos != null ? targetText.match(MENTION_REG) : null
  const emojiMatch =
    pos != null ? targetText.match(EMOJI_REG) : null

  const mentionName =
    mentionMatch != null ? mentionMatch[1] : ''
  const emojiName = emojiMatch != null ? emojiMatch[1] : ''

  const mentionFiltered = useMemo(
    () =>
      CHARACTERS.filter((char) =>
        char
          .toLocaleLowerCase()
          .startsWith(mentionName.toLocaleLowerCase())
      ).slice(0, MAX_LIST_LENGTH),
    [mentionName]
  )

  const emojiFiltered = useMemo(
    () =>
      emojis
        .filter((char) =>
          char.shortcode
            .toLocaleLowerCase()
            .startsWith(emojiName.toLocaleLowerCase())
        )
        .slice(0, MAX_LIST_LENGTH),
    [emojiName, emojis]
  )

  const mentionComplete = (index: number) => {
    if (ref.current == null || pos == null) return
    const selected = mentionFiltered[index]
    ref.current.setRangeText(
      `@${selected} `,
      pos.caret - mentionName.length - 1,
      pos.caret,
      'end'
    )
    setPos(null)
    setIndex(0)
  }

  const emojiComplete = (index: number) => {
    if (ref.current == null || pos == null) return
    const selected = emojiFiltered[index].shortcode
    ref.current.setRangeText(
      Emoji.emojify(`:${selected}: `),
      pos.caret - emojiName.length - 1,
      pos.caret,
      'end'
    )
    setPos(null)
    setIndex(0)
  }

  const customRenderer = createRegexRenderer([
    [MENTION_HIGHLIGHT_REG, { color: 'blue' }],
  ])

  return (
    <>
      <RichTextarea
        placeholder={placeholder}
        ref={ref}
        style={style}
        className="rounded-none"
        onChange={(e) => onChange(e.target.value)}
        value={text}
        onKeyDown={(e) => {
          if (
            pos == null ||
            mentionFiltered.length === 0 ||
            emojiFiltered.length === 0
          )
            return

          switch (e.code) {
            case 'ArrowUp':
              e.preventDefault()
              if (isMention)
                setIndex(
                  index <= 0
                    ? mentionFiltered.length - 1
                    : index - 1
                )
              if (isEmoji)
                setIndex(
                  index <= 0
                    ? emojiFiltered.length - 1
                    : index - 1
                )
              break
            case 'ArrowDown':
              e.preventDefault()
              if (isMention)
                setIndex(
                  index >= mentionFiltered.length - 1
                    ? 0
                    : index + 1
                )
              if (isEmoji)
                setIndex(
                  index >= emojiFiltered.length - 1
                    ? 0
                    : index + 1
                )
              break
            case 'Enter':
              e.preventDefault()
              if (isMention) mentionComplete(index)
              if (isEmoji) emojiComplete(index)
              break
            case 'Quote':
              e.preventDefault()
              if (isEmoji) emojiComplete(index)
              break
            case 'Escape':
              e.preventDefault()
              setPos(null)
              setIndex(0)
              break
            default:
              return
          }
        }}
        onSelectionChange={(r) => {
          if (
            r.focused &&
            MENTION_REG.test(
              text.slice(0, r.selectionStart)
            )
          ) {
            setIsMention(true)
            setPos({
              top: r.top + r.height,
              left: r.left,
              caret: r.selectionStart,
            })
            setIndex(0)
          } else if (
            r.focused &&
            EMOJI_REG.test(text.slice(0, r.selectionStart))
          ) {
            setIsEmoji(true)
            setPos({
              top: r.top + r.height,
              left: r.left,
              caret: r.selectionStart,
            })
            setIndex(0)
          } else {
            setIsEmoji(false)
            setIsMention(false)
            setPos(null)
            setIndex(0)
          }
        }}
      >
        {customRenderer}
      </RichTextarea>
      {pos != null &&
        mentionFiltered.length > 0 &&
        isMention &&
        createPortal(
          <Menu
            top={pos.top}
            left={pos.left}
            chars={mentionFiltered}
            index={index}
            complete={mentionComplete}
          />,
          document.body
        )}

      {pos != null &&
        emojiFiltered.length > 0 &&
        isEmoji &&
        createPortal(
          <EmojiMenu
            top={pos.top}
            left={pos.left}
            chars={emojiFiltered}
            index={index}
            complete={emojiComplete}
          />,
          document.body
        )}
    </>
  )
}
