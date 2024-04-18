/* eslint-disable @next/next/no-img-element */
'use client'

import {
  type CSSProperties,
  type ClipboardEventHandler,
  type Dispatch,
  type SetStateAction,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'

import imageCompression from 'browser-image-compression'
import { type Entity } from 'megalodon'
import * as Emoji from 'node-emoji'
import { createPortal } from 'react-dom'
import {
  RichTextarea,
  type RichTextareaHandle,
  createRegexRenderer,
} from 'rich-textarea'

import { GetClient } from 'util/GetClient'
import { TokenContext } from 'util/provider/AppProvider'
import {
  EmojiContext,
  InstanceContext,
  TagsContext,
  UsersContext,
} from 'util/provider/ResourceProvider'

const MAX_LIST_LENGTH = 8
const MENTION_REG = /\B@([\\.@\-+\w]*)$/
const MENTION_HIGHLIGHT_REG = new RegExp(
  /@([\\.@\-+\w]*)/,
  'g'
)
const EMOJI_REG = /\B:([+\w].*)$/

const TAG_REG = /#(\S*)$/
const TAG_HIGHLIGHT_REG = new RegExp(/#(\S*)/, 'g')

const MentionMenu = ({
  chars,
  index,
  top,
  left,
  complete,
}: {
  chars: Pick<
    Entity.Account,
    'id' | 'acct' | 'avatar' | 'display_name'
  >[]
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
          key={char.id}
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
          <img
            className="mr-2 inline-block h-8 w-8 rounded-full"
            src={char.avatar}
            alt={char.display_name}
            loading="lazy"
          />
          <span>{`@${char.acct}`}</span>
        </div>
      ))}
    </div>
  )
}

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
              loading="lazy"
            />
          )}
          <div>:{char.shortcode}:</div>
        </div>
      ))}
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
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
  onSubmit,
  style,
  setAttachments,
  setUploading,
}: {
  text: string
  placeholder?: string
  onChange: (text: string) => void
  onSubmit: () => void
  style: CSSProperties
  setAttachments: Dispatch<
    SetStateAction<Entity.Attachment[]>
  >
  setUploading: Dispatch<SetStateAction<number>>
}) => {
  const token = useContext(TokenContext)
  const users = useContext(UsersContext)
  const emojis = useContext(EmojiContext)
  const tags = useContext(TagsContext)
  const instance = useContext(InstanceContext)

  const update_limit =
    (instance?.upload_limit ?? 16000000) / 1024 / 1024

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

  const targetText =
    pos != null ? text.slice(0, pos.caret) : text

  const mentionMatch =
    pos != null ? targetText.match(MENTION_REG) : null
  const emojiMatch =
    pos != null ? targetText.match(EMOJI_REG) : null
  const tagMatch =
    pos != null ? targetText.match(TAG_REG) : null

  const mentionName =
    mentionMatch != null ? mentionMatch[1] : ''
  const emojiName = emojiMatch != null ? emojiMatch[1] : ''

  const tagName = tagMatch != null ? tagMatch[1] : ''

  const mentionFiltered = useMemo(
    () =>
      users
        .filter((char) =>
          char.acct
            .toLocaleLowerCase()
            .startsWith(mentionName.toLocaleLowerCase())
        )
        .slice(0, MAX_LIST_LENGTH),
    [mentionName, users]
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

  const tagFiltered = useMemo(
    () =>
      tags
        .filter((char) =>
          char
            .toLocaleLowerCase()
            .startsWith(tagName.toLocaleLowerCase())
        )
        .slice(0, MAX_LIST_LENGTH),
    [tagName, tags]
  )

  const mentionComplete = (index: number) => {
    if (ref.current == null || pos == null) return
    const selected = mentionFiltered[index]
    ref.current.setRangeText(
      `@${selected.acct} `,
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

  const tagComplete = (index: number) => {
    if (ref.current == null || pos == null) return
    const selected = tagFiltered[index]
    if (selected != null) {
      ref.current.setRangeText(
        `#${selected} `,
        pos.caret - tagName.length - 1,
        pos.caret,
        'end'
      )
    }
    setPos(null)
    setIndex(0)
  }

  const customRenderer = createRegexRenderer([
    [MENTION_HIGHLIGHT_REG, { color: 'blue' }],
    [TAG_HIGHLIGHT_REG, { color: 'blue' }],
  ])

  const uploadMedia = (file: File) => {
    if (token == null) return
    const client = GetClient(token?.access_token)
    client
      .uploadMedia(file)
      .then((res) => {
        const Attachment = res.data as Entity.Attachment
        setAttachments((prev) => [...prev, Attachment])
      })
      .finally(() => {
        setUploading((prev) => prev - 1)
      })
  }

  const onPaste: ClipboardEventHandler<
    HTMLTextAreaElement
  > = (e) => {
    if (e.clipboardData.types.includes('Files')) {
      e.preventDefault()
      const files = e.clipboardData.files
      if (files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          setUploading((prev) => prev + 1)
          if (file.type.startsWith('image/')) {
            imageCompression(file, {
              maxSizeMB: update_limit,
              maxWidthOrHeight: 2048,
              useWebWorker: true,
            }).then((compressedFile) => {
              uploadMedia(compressedFile)
            })
          } else {
            uploadMedia(file)
          }
        }
      }
    }
  }

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
            e.code === 'Enter' &&
            (e.ctrlKey || e.metaKey)
          ) {
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
              if (isTag)
                setIndex(
                  index <= 0
                    ? tagFiltered.length - 1
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
              if (isTag)
                setIndex(
                  index >= tagFiltered.length - 1
                    ? 0
                    : index + 1
                )
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
        onSelectionChange={(r) => {
          if (
            r.focused &&
            MENTION_REG.test(
              text.slice(0, r.selectionStart)
            ) &&
            isEmoji === false &&
            isTag === false
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
            EMOJI_REG.test(
              text.slice(0, r.selectionStart)
            ) &&
            isMention === false &&
            isTag === false
          ) {
            setIsEmoji(true)
            setPos({
              top: r.top + r.height,
              left: r.left,
              caret: r.selectionStart,
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
              top: r.top + r.height,
              left: r.left,
              caret: r.selectionStart,
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
        onPaste={onPaste}
      >
        {customRenderer}
      </RichTextarea>
      {pos != null &&
        mentionFiltered.length > 0 &&
        isMention &&
        createPortal(
          <MentionMenu
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
      {pos != null &&
        tagFiltered.length > 0 &&
        isTag &&
        createPortal(
          <Menu
            top={pos.top}
            left={pos.left}
            chars={tagFiltered}
            index={index}
            complete={tagComplete}
          />,
          document.body
        )}
    </>
  )
}
