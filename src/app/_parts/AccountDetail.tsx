/* eslint-disable @next/next/no-img-element */
'use client'

import {
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'

import { ElementType } from 'domelementtype'
import parse, {
  type DOMNode,
  attributesToProps,
  domToReact,
} from 'html-react-parser'
import { type Entity } from 'megalodon'
import innerText from 'react-innertext'

import { UserInfo } from 'app/_parts/UserInfo'
import { GetClient } from 'util/GetClient'
import { TokenContext } from 'util/provider/AppProvider'
import { SetDetailContext } from 'util/provider/DetailProvider'

import { Status } from './Status'

export const AccountDetail = ({
  account,
}: {
  account: Entity.Account
}) => {
  const token = useContext(TokenContext)
  const setDetail = useContext(SetDetailContext)
  const [toots, setToots] = useState<Entity.Status[]>([])
  const [media, setMedia] = useState<Entity.Status[]>([])
  const [relationship, setRelationship] = useState<
    Entity.Relationship | undefined
  >(undefined)
  const [isLoading, setIsLoading] = useState(false)

  const [tab, setTab] = useState<
    'toots' | 'media' | 'favourite'
  >('toots')

  const getEmojiText = (str: string) => {
    let parseStr = str
    if (account.emojis.length > 0) {
      account.emojis.forEach((emoji) => {
        parseStr = parseStr.replace(
          new RegExp(`:${emoji.shortcode}:`, 'gm'),
          `<img src="${emoji.url}" alt="${emoji.shortcode}" class="min-w-4 h-4 inline-block" loading="lazy" />`
        )
      })
    }
    return parseStr
  }

  const replace = (node: DOMNode) => {
    if (
      node.type === ElementType.Tag &&
      node.name === 'a'
    ) {
      if (node.attribs.rel === 'tag') {
        return (
          <a
            {...attributesToProps(node.attribs)}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              setDetail({
                type: 'Hashtag',
                content: e.currentTarget.innerText
                  .toLocaleLowerCase()
                  .replace('#', ''),
              })
            }}
            target="_blank"
          >
            {domToReact(node.children as DOMNode[])}
          </a>
        )
      }

      return (
        <a
          {...attributesToProps(node.attribs)}
          className="text-blue-500"
          rel={[
            node.attribs.rel,
            'noopener noreferrer',
          ].join(' ')}
          target="_blank"
        >
          {domToReact(node.children as DOMNode[])}
        </a>
      )
    }
  }

  useEffect(() => {
    setToots([])
    setMedia([])
  }, [account.id])

  useEffect(() => {
    if (token === null) return
    setIsLoading(true)

    const client = GetClient(token?.access_token)

    client.getRelationship(account.id).then((res) => {
      setRelationship(res.data)
    })

    client
      .getAccountStatuses(account.id, {
        limit: 100,
      })
      .then((res) => {
        setToots(res.data)
        setIsLoading(false)
      })

    client
      .getAccountStatuses(account.id, {
        limit: 100,
        only_media: true,
      })
      .then((res) => {
        setMedia(res.data)
      })
  }, [account.id, token])

  const moreStatus = useCallback(() => {
    if (token === null) return
    setIsLoading(true)
    const client = GetClient(token.access_token)
    client
      .getAccountStatuses(account.id, {
        limit: 40,
        max_id: toots[toots.length - 1].id,
      })
      .then((res) => {
        setToots((prev) => [...prev, ...res.data])
        setIsLoading(false)
      })
  }, [account.id, token, toots])

  const moreMedia = useCallback(() => {
    if (token === null) return
    const client = GetClient(token.access_token)
    client
      .getAccountStatuses(account.id, {
        limit: 40,
        max_id: media[media.length - 1].id,
        only_media: true,
      })
      .then((res) => {
        setMedia((prev) => [...prev, ...res.data])
      })
  }, [account.id, media, token])

  return (
    <>
      <div className="mb-2">
        <img
          src={account.header}
          alt="header"
          className="max-h-80 w-full object-cover"
          loading="lazy"
        />
      </div>
      <UserInfo account={account} />
      {relationship != null && (
        <div className="my-2">
          <div className="my-2">
            <span className="text-gray-400">
              {relationship.followed_by
                ? 'フォローされています'
                : ''}
            </span>
          </div>
          <div className="my-2">
            <div>
              <span className="text-gray-400">
                {relationship.following ? (
                  'フォロー中'
                ) : (
                  <button
                    className="rounded-md border border-blue-500 px-2 py-1 text-blue-500 transition-colors duration-300 ease-in-out hover:bg-blue-500 hover:text-white"
                    onClick={() => {
                      if (token == null) return
                      const client = GetClient(
                        token.access_token
                      )
                      client
                        .followAccount(account.id)
                        .then(() => {
                          setRelationship({
                            ...relationship,
                            following: true,
                          })
                        })
                    }}
                  >
                    フォローする
                  </button>
                )}
              </span>
            </div>
          </div>
        </div>
      )}
      <div className="content my-2">
        {parse(getEmojiText(account.note), { replace })}
      </div>

      <div className="m-1 box-border">
        {account.fields.map((field) => (
          <dl
            key={field.name}
            className="flex w-full border-collapse text-center text-sm"
          >
            <dt
              className="w-28 flex-[0_0_auto] truncate border px-1 py-2"
              title={field.name}
            >
              {getEmojiText(field.name)}
            </dt>
            <dd
              className="flex-[1_1_auto] truncate border px-1 py-2"
              title={innerText(
                parse(getEmojiText(field.value))
              )}
            >
              {parse(getEmojiText(field.value), {
                replace,
              })}
            </dd>
          </dl>
        ))}
      </div>

      <div>
        <div className="m-1 grid grid-cols-2 [&>button]:box-border">
          <button
            className={[
              'border',
              tab === 'toots' ? 'border-blue-500' : '',
            ].join(' ')}
            onClick={() => {
              setTab('toots')
            }}
          >
            Toots
          </button>
          <button
            className={[
              'border',
              tab === 'media' ? 'border-blue-500' : '',
            ].join(' ')}
            onClick={() => {
              setTab('media')
            }}
          >
            Media
          </button>
        </div>
        {tab === 'toots' && (
          <div>
            {toots.map((status) => (
              <Status
                status={status}
                key={status.id}
              />
            ))}
            {isLoading ? (
              <div className="box-border flex h-10 w-full items-center justify-center border-t border-t-gray-500">
                loading...
              </div>
            ) : (
              <button
                className="box-border flex h-10 w-full items-center justify-center border-t border-t-gray-500"
                onClick={moreStatus}
              >
                more
              </button>
            )}
          </div>
        )}
        {tab === 'media' && (
          <div>
            {media.map((status) => (
              <Status
                status={status}
                key={status.id}
              />
            ))}
            {isLoading ? (
              <div className="box-border flex h-10 w-full items-center justify-center border-t border-t-gray-500">
                loading...
              </div>
            ) : (
              <button
                className="box-border flex h-10 w-full items-center justify-center border-t border-t-gray-500"
                onClick={moreMedia}
              >
                more
              </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}
