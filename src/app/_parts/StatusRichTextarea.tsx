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

const wrapIndexPrev = (index: number, length: number): number => {
  if (length <= 0) return 0
  return index <= 0 ? length - 1 : index - 1
}

const wrapIndexNext = (index: number, length: number): number => {
  if (length <= 0) return 0
  return index >= length - 1 ? 0 : index + 1
}

const handleSubmitShortcut = (
  e: KeyboardEvent<HTMLTextAreaElement>,
  onSubmit: () => void,
): boolean => {
  if (e.code === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    onSubmit()
    return true
  }
  return false
}

const shouldSkipAutocompleteKeys = (
  pos: { caret: number; left: number; top: number } | null,
  isMention: boolean,
  isEmoji: boolean,
  isTag: boolean,
  mentionFilteredLength: number,
  emojiFilteredLength: number,
  tagFilteredLength: number,
): boolean => {
  if (pos == null) return true
  if (isMention && mentionFilteredLength === 0) return true
  if (isEmoji && emojiFilteredLength === 0) return true
  if (isTag && tagFilteredLength === 0) return true
  return false
}

type AutocompleteKeyDownHandlers = {
  index: number
  setIndex: Dispatch<SetStateAction<number>>
  isMention: boolean
  isEmoji: boolean
  isTag: boolean
  mentionFilteredLength: number
  emojiFilteredLength: number
  tagFilteredLength: number
  mentionComplete: (index: number) => void
  emojiComplete: (index: number) => void
  tagComplete: (index: number) => void
  setPos: Dispatch<
    SetStateAction<{ top: number; left: number; caret: number } | null>
  >
}

const applyAutocompleteNavigation = (
  direction: 'prev' | 'next',
  index: number,
  setIndex: Dispatch<SetStateAction<number>>,
  isMention: boolean,
  isEmoji: boolean,
  isTag: boolean,
  mentionFilteredLength: number,
  emojiFilteredLength: number,
  tagFilteredLength: number,
): void => {
  const wrap = direction === 'prev' ? wrapIndexPrev : wrapIndexNext
  if (isMention) setIndex(wrap(index, mentionFilteredLength))
  if (isEmoji) setIndex(wrap(index, emojiFilteredLength))
  if (isTag) setIndex(wrap(index, tagFilteredLength))
}

const applyAutocompleteSelection = (
  index: number,
  isMention: boolean,
  isEmoji: boolean,
  isTag: boolean,
  mentionComplete: (index: number) => void,
  emojiComplete: (index: number) => void,
  tagComplete: (index: number) => void,
): void => {
  if (isMention) mentionComplete(index)
  if (isEmoji) emojiComplete(index)
  if (isTag) tagComplete(index)
}

const handleAutocompleteKeyDown = (
  e: KeyboardEvent<HTMLTextAreaElement>,
  handlers: AutocompleteKeyDownHandlers,
): void => {
  const {
    index,
    setIndex,
    isMention,
    isEmoji,
    isTag,
    mentionFilteredLength,
    emojiFilteredLength,
    tagFilteredLength,
    mentionComplete,
    emojiComplete,
    tagComplete,
    setPos,
  } = handlers

  switch (e.code) {
    case 'ArrowUp':
    case 'ArrowDown':
      e.preventDefault()
      applyAutocompleteNavigation(
        e.code === 'ArrowUp' ? 'prev' : 'next',
        index,
        setIndex,
        isMention,
        isEmoji,
        isTag,
        mentionFilteredLength,
        emojiFilteredLength,
        tagFilteredLength,
      )
      break
    case 'Enter':
    case 'Tab':
      e.preventDefault()
      applyAutocompleteSelection(
        index,
        isMention,
        isEmoji,
        isTag,
        mentionComplete,
        emojiComplete,
        tagComplete,
      )
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
}

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
          if (handleSubmitShortcut(e, onSubmit)) return
          if (
            shouldSkipAutocompleteKeys(
              pos,
              isMention,
              isEmoji,
              isTag,
              mentionFiltered.length,
              emojiFiltered.length,
              tagFiltered.length,
            )
          )
            return

          handleAutocompleteKeyDown(e, {
            emojiComplete,
            emojiFilteredLength: emojiFiltered.length,
            index,
            isEmoji,
            isMention,
            isTag,
            mentionComplete,
            mentionFilteredLength: mentionFiltered.length,
            setIndex,
            setPos,
            tagComplete,
            tagFilteredLength: tagFiltered.length,
          })
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
