/* eslint-disable @next/next/no-img-element */
'use client'

import { useContext, useEffect, useState } from 'react'

import { Entity } from 'megalodon'
import { RiCloseCircleLine } from 'react-icons/ri'

import { Panel } from 'app/_parts/Panel'
import { StatusRichTextarea } from 'app/_parts/StatusRichTextarea'
import { UserInfo } from 'app/_parts/UserInfo'
import { GetClient } from 'util/GetClient'
import { TokenContext } from 'util/provider/AppProvider'
import {
  ReplyToContext,
  SetReplyToContext,
} from 'util/provider/ReplyToProvider'

export const MainPanel = () => {
  const token = useContext(TokenContext)
  const replyTo = useContext(ReplyToContext)
  const setReplyTo = useContext(SetReplyToContext)

  const [account, setAccount] =
    useState<Entity.Account | null>(null)

  // form state
  const [visibility, setVisibility] =
    useState<Entity.StatusVisibility>('public')
  const [isCW, setIsCW] = useState(false)
  const [spoilerText, setSpoilerText] = useState('')
  const [content, setContent] = useState('')

  const resetForm = () => {
    setVisibility('public')
    setIsCW(false)
    setSpoilerText('')
    setContent('')
    setReplyTo(undefined)
  }

  const getContentFormatted = (status: Entity.Status) => {
    let content = status.content
    if (status.emojis.length > 0) {
      status.emojis.forEach((emoji) => {
        content = content.replace(
          new RegExp(`:${emoji.shortcode}:`, 'gm'),
          `<img src="${emoji.url}" alt="${emoji.shortcode}" class="min-w-4 h-4 inline-block" />`
        )
      })
    }
    return content
  }

  const clickPost = () => {
    if (token == null) return

    const client = GetClient(token?.access_token)

    client.postStatus(content, {
      visibility: visibility,
      language: 'ja',
      spoiler_text: isCW ? spoilerText : undefined,
      in_reply_to_id: replyTo?.id ?? undefined,
    })

    resetForm()
  }

  // TODO: media post
  // const mediaPost = () => {}

  useEffect(() => {
    setVisibility(replyTo?.visibility ?? 'public')
    setContent(
      replyTo?.account.acct != null
        ? `@${replyTo.account.acct} `
        : ''
    )
  }, [replyTo])

  useEffect(() => {
    if (token == null) return
    const client = GetClient(token?.access_token)

    client.verifyAccountCredentials().then((res) => {
      setAccount(res.data)
    })
  }, [token])

  if (token == null || account == null) {
    return null
  }

  return (
    <Panel>
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
                  e.target.value as Entity.StatusVisibility
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
                onChange={(e) => setIsCW(e.target.checked)}
              />
              <span className={isCW ? 'text-blue-400' : ''}>
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
            onChange={(e) => setSpoilerText(e.target.value)}
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
          />
        </div>
        <div>
          <button
            className="rounded-md border px-3 py-2"
            onClick={clickPost}
          >
            Post
          </button>
        </div>
      </div>
    </Panel>
  )
}
