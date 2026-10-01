/* eslint-disable @next/next/no-img-element */
'use client'

import { UserInfo } from 'app/_parts/UserInfo'

import { ElementType } from 'domelementtype'
import parse, {
  attributesToProps,
  type DOMNode,
  domToReact,
} from 'html-react-parser'
import type { Entity } from 'megalodon'
import {
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import innerText from 'react-innertext'
import { Virtuoso } from 'react-virtuoso'
import type { AccountAddAppIndex } from 'types/types'
import { replaceEmojis } from 'util/emojiReplacer'
import { GetClient } from 'util/GetClient'
import { useAccountStatuses } from 'util/hooks/useAccountStatuses'
import { AppsContext } from 'util/provider/AppsProvider'
import { SetDetailContext } from 'util/provider/DetailProvider'
import { toSecureResourceUrl } from 'util/secureResourceUrl'

import { Status } from './Status'

type AccountDetailListContext = {
  appIndex: number
  header: ReactNode
  isLoading: boolean
  isScrolling: boolean
  error: boolean
  loadMore: () => void
  onStatusChange: (statusId: string, updates: Partial<Entity.Status>) => void
}

function AccountDetailHeader({
  context,
}: Readonly<{
  context?: AccountDetailListContext
}>) {
  return context?.header
}

function AccountDetailFooter({
  context,
}: Readonly<{
  context?: AccountDetailListContext
}>) {
  if (context?.isLoading) {
    return (
      <output className="flex items-center justify-center py-4">
        読み込み中…
      </output>
    )
  }
  if (context?.error) {
    return (
      <button
        className="w-full border-t border-gray-500 py-2 text-blue-500"
        onClick={context.loadMore}
        type="button"
      >
        読み込みに失敗しました。再試行
      </button>
    )
  }
  return null
}

const accountDetailComponents = {
  Footer: AccountDetailFooter,
  Header: AccountDetailHeader,
}

function renderAccountDetailItem(
  _index: number,
  status: Entity.Status,
  context: AccountDetailListContext,
) {
  return (
    <Status
      onStatusChange={(updates) => {
        context.onStatusChange(status.reblog?.id ?? status.id, updates)
      }}
      scrolling={context.isScrolling}
      status={{ ...status, appIndex: context.appIndex }}
    />
  )
}

export const AccountDetail = ({ account }: { account: AccountAddAppIndex }) => {
  const apps = useContext(AppsContext)
  const setDetail = useContext(SetDetailContext)
  const toots = useAccountStatuses(apps[account.appIndex], account.id)
  const media = useAccountStatuses(apps[account.appIndex], account.id, true)
  const [relationship, setRelationship] = useState<
    Entity.Relationship | undefined
  >(undefined)
  const [isScrolling, setIsScrolling] = useState(false)

  // API で完全プロフィールを取得済みかを追跡
  const resolvedAccountIdRef = useRef<string | null>(null)

  const [tab, setTab] = useState<'toots' | 'media'>('toots')
  const posts = tab === 'toots' ? toots : media

  const { updateStatus: updateTootStatus } = toots
  const { updateStatus: updateMediaStatus } = media
  const onStatusChange = useCallback(
    (statusId: string, updates: Partial<Entity.Status>) => {
      updateTootStatus(statusId, updates)
      updateMediaStatus(statusId, updates)
    },
    [updateMediaStatus, updateTootStatus],
  )

  const getEmojiText = useCallback(
    (str: string) =>
      replaceEmojis(str, account.emojis, 'min-w-4 h-4 inline-block'),
    [account.emojis],
  )

  const accountNote = useMemo(
    () => getEmojiText(account.note),
    [account.note, getEmojiText],
  )

  const replace = (node: DOMNode) => {
    if (node.type === ElementType.Tag && node.name === 'a') {
      if (node.attribs.rel === 'tag') {
        return (
          <button
            className={[
              'cursor-pointer border-0 bg-transparent p-0 text-blue-500',
              node.attribs.class,
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={(e) => {
              e.stopPropagation()
              setDetail({
                content: e.currentTarget.innerText
                  .toLocaleLowerCase()
                  .replace('#', ''),
                type: 'Hashtag',
              })
            }}
            title={node.attribs.title}
            type="button"
          >
            {domToReact(node.children as DOMNode[])}
          </button>
        )
      }

      return (
        <a
          {...attributesToProps(node.attribs)}
          className="text-blue-500"
          rel={[node.attribs.rel, 'noopener noreferrer'].join(' ')}
          target="_blank"
        >
          {domToReact(node.children as DOMNode[])}
        </a>
      )
    }
  }

  // account の詳細データ（note, fields 等）が不足している場合、API で完全なデータを取得する
  useEffect(() => {
    const app = apps[account.appIndex]
    if (!account.acct || !app) return
    // 既にこの account.id で解決済みならスキップ
    if (resolvedAccountIdRef.current === (account.id || account.acct)) return

    const client = GetClient(app)
    let cancelled = false

    if (account.id) {
      // id がある場合は getAccount で完全なプロフィールを取得
      resolvedAccountIdRef.current = account.id
      client
        .getAccount(account.id)
        .then((res) => {
          if (cancelled) return
          setDetail({
            content: { ...res.data, appIndex: account.appIndex },
            type: 'Account',
          })
        })
        .catch((error) => {
          console.error('Failed to fetch account:', error)
        })
    } else {
      // id が空（SQLite キャッシュ由来）の場合は searchAccount でアカウントを解決する
      resolvedAccountIdRef.current = account.acct
      client
        .searchAccount(account.acct, { limit: 1, resolve: true })
        .then((res) => {
          if (cancelled) return
          const found = res.data.find(
            (a) => a.acct === account.acct || a.url === account.url,
          )
          if (found) {
            setDetail({
              content: { ...found, appIndex: account.appIndex },
              type: 'Account',
            })
          }
        })
        .catch((error) => {
          console.error('Failed to resolve account:', error)
        })
    }
    return () => {
      cancelled = true
      resolvedAccountIdRef.current = null
    }
  }, [account.acct, account.appIndex, account.id, account.url, apps, setDetail])

  useEffect(() => {
    const app = apps[account.appIndex]
    if (!app || !account.id) return
    let cancelled = false
    const client = GetClient(app)

    client
      .getRelationship(account.id)
      .then((res) => {
        if (!cancelled) setRelationship(res.data)
      })
      .catch((error) => {
        console.error('Failed to fetch relationship:', error)
      })

    return () => {
      cancelled = true
    }
  }, [account.appIndex, account.id, apps])

  const header = (
    <>
      <div className="mb-2">
        <img
          alt="header"
          className="max-h-80 w-full object-cover"
          loading="lazy"
          src={toSecureResourceUrl(account.header)}
        />
      </div>
      <UserInfo account={account} />
      {relationship != null && (
        <div className="my-2">
          <div className="my-2">
            <span className="text-gray-400">
              {relationship.followed_by ? 'フォローされています' : ''}
            </span>
          </div>
          <div className="my-2">
            <div>
              <span className="text-gray-400">
                {relationship.following ? (
                  <button
                    className="rounded-md border border-red-500 px-2 py-1 text-red-500 transition-colors duration-300 ease-in-out hover:bg-red-500 hover:text-white"
                    onClick={() => {
                      if (apps.length <= 0) return
                      const client = GetClient(apps[account.appIndex])
                      client
                        .unfollowAccount(account.id)
                        .then(() => {
                          setRelationship({
                            ...relationship,
                            following: true,
                          })
                        })
                        .catch((error) => {
                          console.error('Failed to unfollow account:', error)
                        })
                    }}
                    type="button"
                  >
                    フォロー解除
                  </button>
                ) : (
                  <button
                    className="rounded-md border border-blue-500 px-2 py-1 text-blue-500 transition-colors duration-300 ease-in-out hover:bg-blue-500 hover:text-white"
                    onClick={() => {
                      if (apps.length <= 0) return
                      const client = GetClient(apps[account.appIndex])
                      client
                        .followAccount(account.id)
                        .then(() => {
                          setRelationship({
                            ...relationship,
                            following: true,
                          })
                        })
                        .catch((error) => {
                          console.error('Failed to follow account:', error)
                        })
                    }}
                    type="button"
                  >
                    フォローする
                  </button>
                )}
              </span>
              <span className="text-gray-400">
                {relationship.notifying ? (
                  <button
                    className="rounded-md border border-red-500 px-2 py-1 text-red-500 transition-colors duration-300 ease-in-out hover:bg-red-500 hover:text-white"
                    onClick={() => {
                      if (apps.length <= 0) return
                      const client = GetClient(apps[account.appIndex])
                      client
                        .unsubscribeAccount(account.id)
                        .then(() => {
                          setRelationship({
                            ...relationship,
                            notifying: false,
                          })
                        })
                        .catch((error) => {
                          console.error('Failed to unsubscribe account:', error)
                        })
                    }}
                    type="button"
                  >
                    購読解除
                  </button>
                ) : (
                  <button
                    className="rounded-md border border-blue-500 px-2 py-1 text-blue-500 transition-colors duration-300 ease-in-out hover:bg-blue-500 hover:text-white"
                    onClick={() => {
                      if (apps.length <= 0) return

                      const client = GetClient(apps[account.appIndex])

                      client
                        .subscribeAccount(account.id)
                        .then(() => {
                          setRelationship({
                            ...relationship,
                            notifying: true,
                          })
                        })
                        .catch((error) => {
                          console.error('Failed to subscribe account:', error)
                        })
                    }}
                    type="button"
                  >
                    購読する
                  </button>
                )}
              </span>
            </div>
          </div>
        </div>
      )}
      <div className="content my-2">{parse(accountNote, { replace })}</div>

      <div className="m-1 box-border">
        {account.fields.map((field) => (
          <dl
            className="flex w-full border-collapse text-center text-sm"
            key={field.name}
          >
            <dt
              className="w-28 flex-[0_0_auto] truncate border px-1 py-2"
              title={field.name}
            >
              {getEmojiText(field.name)}
            </dt>
            <dd
              className="flex-[1_1_auto] truncate border px-1 py-2"
              title={innerText(parse(getEmojiText(field.value)))}
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
              setIsScrolling(false)
              setTab('toots')
            }}
            type="button"
          >
            Toots
          </button>
          <button
            className={[
              'border',
              tab === 'media' ? 'border-blue-500' : '',
            ].join(' ')}
            onClick={() => {
              setIsScrolling(false)
              setTab('media')
            }}
            type="button"
          >
            Media
          </button>
        </div>
      </div>
    </>
  )

  return (
    <Virtuoso
      components={accountDetailComponents}
      computeItemKey={(_, status) => status.id}
      context={{
        appIndex: account.appIndex,
        error: posts.error,
        header,
        isLoading: posts.isLoading,
        isScrolling,
        loadMore: posts.loadMore,
        onStatusChange,
      }}
      data={posts.statuses}
      endReached={posts.hasMore && !posts.error ? posts.loadMore : undefined}
      increaseViewportBy={200}
      isScrolling={setIsScrolling}
      itemContent={renderAccountDetailItem}
      key={tab}
    />
  )
}
