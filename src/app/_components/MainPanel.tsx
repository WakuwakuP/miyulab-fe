/* eslint-disable @next/next/no-img-element */
'use client'

import { Dropzone } from 'app/_parts/Dropzone'
import { Panel } from 'app/_parts/Panel'
import { StatusRichTextarea } from 'app/_parts/StatusRichTextarea'
import { UserInfo } from 'app/_parts/UserInfo'
import type { Entity } from 'megalodon'
import {
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
} from 'react'
import { RiCloseCircleLine, RiPlayFill } from 'react-icons/ri'
import { GetClient } from 'util/GetClient'
import { canPlay } from 'util/PlayerUtils'
import { AppsContext } from 'util/provider/AppsProvider'
import { SetPlayerContext } from 'util/provider/PlayerProvider'
import {
  ReplyToContext,
  SetReplyToContext,
} from 'util/provider/ReplyToProvider'
import { SettingContext } from 'util/provider/SettingProvider'

export const MainPanel = () => {
  const apps = useContext(AppsContext)
  const replyTo = useContext(ReplyToContext)
  const setReplyTo = useContext(SetReplyToContext)
  const setPlayer = useContext(SetPlayerContext)
  const { defaultStatusVisibility } = useContext(SettingContext)
  const [account, setAccount] = useState<Entity.Account | null>(null)

  // form state
  const [visibility, setVisibility] = useState<Entity.StatusVisibility>(
    defaultStatusVisibility,
  )
  const [isCW, setIsCW] = useState(false)
  const [spoilerText, setSpoilerText] = useState('')
  const [content, setContent] = useState('')

  const [attachments, setAttachments] = useState<Entity.Attachment[]>([])

  const [uploading, setUploading] = useState(0)

  const [mediaLink, setMediaLink] = useState('')
  const [isPlay, setIsPlay] = useState(false)

  const resetForm = () => {
    setVisibility(defaultStatusVisibility)
    setIsCW(false)
    setSpoilerText('')
    setContent('')
    setReplyTo(undefined)
    setAttachments([])
  }

  const getContentFormatted = (status: Entity.Status) => {
    let content = status.content
    if (status.emojis.length > 0) {
      status.emojis.forEach((emoji) => {
        content = content.replace(
          new RegExp(`:${emoji.shortcode}:`, 'gm'),
          `<img src="${emoji.url}" alt="${emoji.shortcode}" class="min-w-4 h-4 inline-block" loading="lazy" />`,
        )
      })
    }
    return content
  }

  const contentFormatted = () => {
    if (replyTo == null) return ''
    return getContentFormatted(replyTo)
  }

  const clickPost = () => {
    if (apps.length <= 0) return
    if (content === '') return

    const client = GetClient(apps[0])

    client
      .postStatus(content, {
        in_reply_to_id: replyTo?.id ?? undefined,
        language: 'ja',
        media_ids:
          attachments.length > 0 ? attachments.map((a) => a.id) : undefined,
        spoiler_text: isCW ? spoilerText : undefined,
        visibility: visibility,
      })
      .catch((error) => {
        console.error('Failed to post status:', error)
      })

    resetForm()
  }

  useEffect(() => {
    setVisibility(replyTo?.visibility ?? 'public')
    setContent(replyTo?.account.acct != null ? `@${replyTo.account.acct} ` : '')
  }, [replyTo])

  useEffect(() => {
    if (apps.length <= 0) return
    const client = GetClient(apps[0])

    client
      .verifyAccountCredentials()
      .then((res) => {
        setAccount(res.data)
      })
      .catch((error) => {
        console.error('Failed to verify account credentials:', error)
      })
  }, [apps])

  useEffect(() => {
    setVisibility(defaultStatusVisibility)
  }, [defaultStatusVisibility])

  const onCheckMediaLink = useEffectEvent(() => {
    if (mediaLink === '') return
    setIsPlay(canPlay(mediaLink))
  })

  useEffect(() => {
    void mediaLink // 明示的に依存があることを示す
    onCheckMediaLink()
  }, [mediaLink])

  const onPlay = useCallback(() => {
    setPlayer({
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
          url: mediaLink,
        },
      ],
      index: 0,
    })
    setMediaLink('')
    setIsPlay(false)
  }, [mediaLink, setPlayer])

  if (apps.length <= 0 || account == null) {
    return null
  }

  return (
    <Panel className="p-1">
      <div className="relative h-full">
        <UserInfo account={{ ...account, appIndex: 0 }} />
        <div className="px-2 *:mt-2">
          <div className="flex items-center space-x-2">
            <div>
              <select
                className="w-fit rounded-md border text-black"
                id="visibility"
                name="visibility"
                onChange={(e) =>
                  setVisibility(e.target.value as Entity.StatusVisibility)
                }
                value={visibility}
              >
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
                <option value="direct">Direct</option>
              </select>
            </div>
            <div>
              <label
                className="cursor-pointer rounded-md border px-3 py-2"
                htmlFor="is-cw"
              >
                <input
                  checked={isCW}
                  className="hidden"
                  id="is-cw"
                  name="is-cw"
                  onChange={(e) => setIsCW(e.target.checked)}
                  type="checkbox"
                />
                <span className={isCW ? 'text-blue-400' : ''}>CW</span>
              </label>
            </div>
          </div>

          <div className={isCW ? 'block' : 'hidden'}>
            <input
              className="w-full"
              onChange={(e) => setSpoilerText(e.target.value)}
              placeholder="CW"
              value={spoilerText}
            />
          </div>
          <div>
            {replyTo != null && (
              <div className="rounded-md bg-gray-500 p-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1">
                    <img
                      alt={replyTo.account.display_name}
                      className="h-8 w-8 rounded-md"
                      loading="lazy"
                      src={replyTo.account.avatar}
                    />
                    <div>
                      <div>
                        <span>{replyTo.account.display_name}</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <button
                      onClick={() => {
                        setReplyTo(undefined)
                      }}
                      type="button"
                    >
                      <RiCloseCircleLine size={32} />
                    </button>
                  </div>
                </div>
                <div
                  className="content p-2"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: TODO:
                  dangerouslySetInnerHTML={{
                    __html: contentFormatted,
                  }}
                />
              </div>
            )}
          </div>
          <div className="text-black">
            <StatusRichTextarea
              onChange={setContent}
              onSubmit={clickPost}
              placeholder="What's happening?"
              setAttachments={setAttachments}
              setUploading={setUploading}
              style={{
                backgroundColor: 'white',
                height: '10rem',
                overflowY: 'auto',
                resize: 'none',
                width: '100%',
              }}
              text={content}
            />
          </div>
          <div>
            <button
              className="rounded-md border bg-slate-500 px-3 py-2"
              onClick={clickPost}
              type="button"
            >
              Post
            </button>
          </div>
          <div>
            <Dropzone
              attachments={attachments}
              setAttachments={setAttachments}
              setUploading={setUploading}
              uploading={uploading}
            >
              <div className="flex h-48 w-full cursor-pointer flex-wrap items-center justify-center border-4 border-dotted border-gray-400">
                <p>Image Drop Area</p>
              </div>
            </Dropzone>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0">
          <div className="flex p-2">
            <input
              className="min-w-0 grow bg-gray-600 text-white"
              onChange={(e) => setMediaLink(e.target.value)}
              placeholder="media link"
              type="text"
              value={mediaLink}
            />
            <button
              className="border p-2 disabled:border-gray-600 disabled:text-gray-600"
              disabled={!isPlay}
              onClick={onPlay}
              type="button"
            >
              <RiPlayFill size={30} />
            </button>
          </div>
        </div>
      </div>
    </Panel>
  )
}
