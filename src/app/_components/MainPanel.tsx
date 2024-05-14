/* eslint-disable @next/next/no-img-element */
'use client'

import {
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'

import { type Entity } from 'megalodon'
import {
  RiCloseCircleLine,
  RiPlayFill,
} from 'react-icons/ri'
import ReactPlayer from 'react-player'

import { Dropzone } from 'app/_parts/Dropzone'
import { Panel } from 'app/_parts/Panel'
import { StatusRichTextarea } from 'app/_parts/StatusRichTextarea'
import { UserInfo } from 'app/_parts/UserInfo'
import { GetClient } from 'util/GetClient'
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
  const { defaultStatusVisibility } =
    useContext(SettingContext)
  const [account, setAccount] =
    useState<Entity.Account | null>(null)

  // form state
  const [visibility, setVisibility] =
    useState<Entity.StatusVisibility>(
      defaultStatusVisibility
    )
  const [isCW, setIsCW] = useState(false)
  const [spoilerText, setSpoilerText] = useState('')
  const [content, setContent] = useState('')

  const [attachments, setAttachments] = useState<
    Entity.Attachment[]
  >([])

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
          `<img src="${emoji.url}" alt="${emoji.shortcode}" class="min-w-4 h-4 inline-block" loading="lazy" />`
        )
      })
    }
    return content
  }

  const clickPost = () => {
    if (apps.length <= 0) return
    if (content === '') return

    const client = GetClient(apps[0])

    client.postStatus(content, {
      visibility: visibility,
      language: 'ja',
      spoiler_text: isCW ? spoilerText : undefined,
      in_reply_to_id: replyTo?.id ?? undefined,
      media_ids:
        attachments.length > 0
          ? attachments.map((a) => a.id)
          : undefined,
    })

    resetForm()
  }

  useEffect(() => {
    setVisibility(replyTo?.visibility ?? 'public')
    setContent(
      replyTo?.account.acct != null
        ? `@${replyTo.account.acct} `
        : ''
    )
  }, [replyTo])

  useEffect(() => {
    if (apps.length <= 0) return
    const client = GetClient(apps[0])

    client.verifyAccountCredentials().then((res) => {
      setAccount(res.data)
    })
  }, [apps])

  useEffect(() => {
    setVisibility(defaultStatusVisibility)
  }, [defaultStatusVisibility])

  useEffect(() => {
    if (mediaLink === '') return
    setIsPlay(ReactPlayer.canPlay(mediaLink))
  }, [mediaLink])

  const onPlay = useCallback(() => {
    setPlayer({
      attachment: [
        {
          id: '',
          url: mediaLink,
          type: 'video',
          blurhash: null,
          remote_url: null,
          preview_url: null,
          text_url: null,
          meta: null,
          description: '',
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
        <UserInfo account={account} />
        <div className="px-2 [&>*]:mt-2">
          <div className="flex items-center space-x-2">
            <div>
              <select
                id="visibility"
                name="visibility"
                className="w-fit rounded-md border text-black"
                value={visibility}
                onChange={(e) =>
                  setVisibility(
                    e.target
                      .value as Entity.StatusVisibility
                  )
                }
              >
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
                <option value="direct">Direct</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="is-cw"
                className="cursor-pointer rounded-md border px-3 py-2"
              >
                <input
                  id="is-cw"
                  name="is-cw"
                  type="checkbox"
                  className="hidden"
                  checked={isCW}
                  onChange={(e) =>
                    setIsCW(e.target.checked)
                  }
                />
                <span
                  className={isCW ? 'text-blue-400' : ''}
                >
                  CW
                </span>
              </label>
            </div>
          </div>

          <div className={isCW ? 'block' : 'hidden'}>
            <input
              className="w-full"
              placeholder="CW"
              value={spoilerText}
              onChange={(e) =>
                setSpoilerText(e.target.value)
              }
            />
          </div>
          <div>
            {replyTo != null && (
              <div className="rounded-md bg-gray-500 p-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1">
                    <img
                      src={replyTo.account.avatar}
                      alt={replyTo.account.display_name}
                      className="h-8 w-8 rounded-md"
                      loading="lazy"
                    />
                    <div>
                      <div>
                        <span>
                          {replyTo.account.display_name}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <button
                      onClick={() => {
                        setReplyTo(undefined)
                      }}
                    >
                      <RiCloseCircleLine size={32} />
                    </button>
                  </div>
                </div>
                <div
                  className="content p-2"
                  dangerouslySetInnerHTML={{
                    __html: getContentFormatted(replyTo),
                  }}
                />
              </div>
            )}
          </div>
          <div className="text-black">
            <StatusRichTextarea
              text={content}
              placeholder="What's happening?"
              onSubmit={clickPost}
              style={{
                width: '100%',
                height: '10rem',
                backgroundColor: 'white',
                overflowY: 'auto',
                resize: 'none',
              }}
              onChange={setContent}
              setAttachments={setAttachments}
              setUploading={setUploading}
            />
          </div>
          <div>
            <button
              className="rounded-md border bg-slate-500 px-3 py-2"
              onClick={clickPost}
            >
              Post
            </button>
          </div>
          <div>
            <Dropzone
              attachments={attachments}
              setAttachments={setAttachments}
              uploading={uploading}
              setUploading={setUploading}
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
              type="text"
              className="min-w-0 grow bg-gray-600 text-white"
              placeholder="media link"
              value={mediaLink}
              onChange={(e) => setMediaLink(e.target.value)}
            />
            <button
              className="border p-2 disabled:border-gray-600 disabled:text-gray-600"
              disabled={!isPlay}
              onClick={onPlay}
            >
              <RiPlayFill size={30} />
            </button>
          </div>
        </div>
      </div>
    </Panel>
  )
}
