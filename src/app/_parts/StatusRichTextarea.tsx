'use client'

import { EmojiMenu, MentionMenu, TagMenu } from 'app/_parts/AutocompleteMenus'
import {
  EMOJI_HIGHLIGHT_REG,
  EMOJI_REG,
  MAX_LIST_LENGTH,
  MENTION_HIGHLIGHT_REG,
  MENTION_REG,
  TAG_HIGHLIGHT_REG,
  TAG_REG,
} from 'app/_parts/statusRichTextareaConstants'
import { useMediaUpload } from 'app/_parts/useMediaUpload'
import type { Entity } from 'megalodon'
import * as Emoji from 'node-emoji'
import {
  type ChangeEvent,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  type CaretPosition,
  createRegexRenderer,
  RichTextarea,
  type RichTextareaHandle,
} from 'rich-textarea'

import {
  EmojiContext,
  TagsContext,
  UsersContext,
} from 'util/provider/ResourceProvider'

export const StatusRichTextarea = ({
  text,
  placeholder = '',
  onChange,
  onSubmit,
  style,
  setAttachments,
  setUploading,
  appIndex = 0,
}: {
  text: string
  placeholder?: string
  onChange: (text: string) => void
  onSubmit: () => void
  style: CSSProperties
  setAttachments: Dispatch<SetStateAction<Entity.Attachment[]>>
  setUploading: Dispatch<SetStateAction<number>>
  appIndex?: number
}) => {
  const users = useContext(UsersContext)
  const emojis = useContext(EmojiContext)
  const tags = useContext(TagsContext)

  const { onPaste } = useMediaUpload({ appIndex, setAttachments, setUploading })

  const ref = useRef<RichTextareaHandle>(null)

  const [pos, setPos] = useState<{
    top: number
    left: number
    caret: number
  } | null>(null)

  const [index, setIndex] = useState<number>(0)

  const [isMention, setIsMention] = useState(false)
  const [isEmoji, setIsEmoji] = useState(false)
  const [isTag, setIsTag] = useState(false)

  const targetText = pos != null ? text.slice(0, pos.caret) : text

  const mentionMatch = pos != null ? targetText.match(MENTION_REG) : null
  const emojiMatch = pos != null ? targetText.match(EMOJI_REG) : null
  const tagMatch = pos != null ? targetText.match(TAG_REG) : null

  const mentionName = mentionMatch != null ? mentionMatch[1] : ''
  const emojiName = emojiMatch != null ? emojiMatch[1] : ''

  const tagName = tagMatch != null ? tagMatch[1] : ''

  const mentionFiltered = useMemo(
    () =>
      users
        .filter((char) =>
          char.acct
            .toLocaleLowerCase()
            .startsWith(mentionName.toLocaleLowerCase()),
        )
        .slice(0, MAX_LIST_LENGTH),
    [mentionName, users],
  )

  const emojiFiltered = useMemo(
    () =>
      emojis
        .filter((char) =>
          char.shortcode
            .toLocaleLowerCase()
            .startsWith(emojiName.toLocaleLowerCase()),
        )
        .slice(0, MAX_LIST_LENGTH),
    [emojiName, emojis],
  )

  const tagFiltered = useMemo(
    () =>
      tags
        .filter((char) =>
          char.toLocaleLowerCase().startsWith(tagName.toLocaleLowerCase()),
        )
        .slice(0, MAX_LIST_LENGTH),
    [tagName, tags],
  )

  const mentionComplete = (index: number) => {
    if (ref.current == null || pos == null) return
    const selected = mentionFiltered[index]
    ref.current.setRangeText(
      `@${selected.acct} `,
      pos.caret - mentionName.length - 1,
      pos.caret,
      'end',
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
      'end',
    )
    setPos(null)
    setIndex(0)
  }

  const tagComplete = (index: number) => {
    if (ref.current == null || pos == null) return
    const selected = tagFiltered[index]
    if (selected != null) {
      ref.current.setRangeText(
        `#${selected} `,
        pos.caret - tagName.length - 1,
        pos.caret,
        'end',
      )
    }
    setPos(null)
    setIndex(0)
  }

  const customRenderer = createRegexRenderer([
    [MENTION_HIGHLIGHT_REG, { color: 'blue' }],
    [TAG_HIGHLIGHT_REG, { color: 'blue' }],
    [EMOJI_HIGHLIGHT_REG, { color: 'darkorange' }],
  ])

  return (
    <>
      <RichTextarea
        className="rounded-none"
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
          onChange(e.target.value)
        }
        onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
          if (e.code === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            onSubmit()
            return
          }

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
                setIndex(index <= 0 ? mentionFiltered.length - 1 : index - 1)
              if (isEmoji)
                setIndex(index <= 0 ? emojiFiltered.length - 1 : index - 1)
              if (isTag)
                setIndex(index <= 0 ? tagFiltered.length - 1 : index - 1)
              break
            case 'ArrowDown':
              e.preventDefault()
              if (isMention)
                setIndex(index >= mentionFiltered.length - 1 ? 0 : index + 1)
              if (isEmoji)
                setIndex(index >= emojiFiltered.length - 1 ? 0 : index + 1)
              if (isTag)
                setIndex(index >= tagFiltered.length - 1 ? 0 : index + 1)
              break
            case 'Enter':
            case 'Tab':
              e.preventDefault()
              if (isMention) mentionComplete(index)
              if (isEmoji) emojiComplete(index)
              if (isTag) tagComplete(index)
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
        onPaste={onPaste}
        onSelectionChange={(r: CaretPosition) => {
          if (
            r.focused &&
            MENTION_REG.test(text.slice(0, r.selectionStart)) &&
            isEmoji === false &&
            isTag === false
          ) {
            setIsMention(true)
            setPos({
              caret: r.selectionStart,
              left: r.left,
              top: r.top + r.height,
            })
            setIndex(0)
          } else if (
            r.focused &&
            EMOJI_REG.test(text.slice(0, r.selectionStart)) &&
            isMention === false &&
            isTag === false
          ) {
            setIsEmoji(true)
            setPos({
              caret: r.selectionStart,
              left: r.left,
              top: r.top + r.height,
            })
            setIndex(0)
          } else if (
            r.focused &&
            TAG_REG.test(text.slice(0, r.selectionStart)) &&
            isMention === false &&
            isEmoji === false
          ) {
            setIsTag(true)
            setPos({
              caret: r.selectionStart,
              left: r.left,
              top: r.top + r.height,
            })
            setIndex(0)
          } else {
            setIsEmoji(false)
            setIsMention(false)
            setIsTag(false)
            setPos(null)
            setIndex(0)
          }
        }}
        placeholder={placeholder}
        ref={ref}
        style={style}
        value={text}
      >
        {customRenderer}
      </RichTextarea>
      {pos != null &&
        mentionFiltered.length > 0 &&
        isMention &&
        createPortal(
          <MentionMenu
            chars={mentionFiltered}
            complete={mentionComplete}
            index={index}
            left={pos.left}
            top={pos.top}
          />,
          document.body,
        )}

      {pos != null &&
        emojiFiltered.length > 0 &&
        isEmoji &&
        createPortal(
          <EmojiMenu
            chars={emojiFiltered}
            complete={emojiComplete}
            index={index}
            left={pos.left}
            top={pos.top}
          />,
          document.body,
        )}
      {pos != null &&
        tagFiltered.length > 0 &&
        isTag &&
        createPortal(
          <TagMenu
            chars={tagFiltered}
            complete={tagComplete}
            index={index}
            left={pos.left}
            top={pos.top}
          />,
          document.body,
        )}
    </>
  )
}
