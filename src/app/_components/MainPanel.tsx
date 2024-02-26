'use client'

import { useContext, useEffect, useState } from 'react'

import { Entity } from 'megalodon'

import { Panel } from 'app/_parts/Panel'
import { StatusRichTextarea } from 'app/_parts/StatusRichTextarea'
import { UserInfo } from 'app/_parts/UserInfo'
import { GetClient } from 'util/GetClient'
import { TokenContext } from 'util/provider/AppProvider'

export const MainPanel = () => {
  const token = useContext(TokenContext)

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
  }

  const clickPost = () => {
    if (token == null) return

    const client = GetClient(token?.access_token)

    client.postStatus(content, {
      visibility: visibility,
      language: 'ja',
      spoiler_text: isCW ? spoilerText : undefined,
    })

    resetForm()
  }

  // TODO: media post
  // const mediaPost = () => {}

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
        <div className="flex items-center space-x-1">
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
        <div className="text-black">
          <StatusRichTextarea
            text={content}
            placeholder="What's happening?"
            style={{
              width: '100%',
              height: '10rem',
              backgroundColor: 'white',
              borderRadius: '1rem',
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
