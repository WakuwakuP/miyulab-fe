/* eslint-disable @next/next/no-img-element */

import { ProxyImage } from 'app/_parts/ProxyImage'
import { Status } from 'app/_parts/Status'
import { TruncatedDisplayName } from 'app/_parts/TruncatedDisplayName'

import * as emoji from 'node-emoji'
import type { KeyboardEvent } from 'react'
import { useContext, useMemo } from 'react'
import { RiStarFill } from 'react-icons/ri'
import type { NotificationAddAppIndex } from 'types/types'
import { formatDisplayNameHtml } from 'util/formatDisplayName'
import { AppsContext } from 'util/provider/AppsProvider'
import { SetDetailContext } from 'util/provider/DetailProvider'
import {
  EmojiCatalogContext,
  EmojiContext,
} from 'util/provider/ResourceProvider'
import { toSecureResourceUrl } from 'util/secureResourceUrl'

const AvatarPlaceholder = () => (
  <div className="h-12 w-12 flex-none rounded-lg bg-gray-600" />
)

const ReactionDisplay = ({
  reactionName,
  resolvedReactionUrl,
  scrolling,
}: {
  reactionName?: string
  resolvedReactionUrl: string | null
  scrolling: boolean
}) => {
  if (resolvedReactionUrl == null) {
    return (
      <span className="text-3xl" title={emoji.which(reactionName ?? '')}>
        {reactionName ?? ''}
      </span>
    )
  }

  if (scrolling) {
    return <div className="h-12 w-12 flex-none rounded-lg" />
  }

  return (
    <img
      alt="emoji"
      className="h-12 max-w-full flex-none rounded-lg object-contain"
      decoding="async"
      loading="lazy"
      src={toSecureResourceUrl(resolvedReactionUrl)}
      title={reactionName}
    />
  )
}

export const Notification = ({
  notification,
  scrolling = false,
}: {
  notification: NotificationAddAppIndex
  scrolling?: boolean
}) => {
  const setDetail = useContext(SetDetailContext)
  const apps = useContext(AppsContext)
  const emojiCatalog = useContext(EmojiCatalogContext)
  const emojiFallback = useContext(EmojiContext)

  // リアクションがカスタム絵文字の場合、URLが空でもカタログから解決する
  const resolvedReactionUrl = useMemo(() => {
    const reaction = notification.reaction
    if (!reaction) return null
    if (reaction.static_url || reaction.url)
      return reaction.static_url ?? reaction.url ?? null

    // カスタム絵文字 (:name:) でURLが無い場合 — 絵文字カタログから解決
    const name = reaction.name
    if (!name.startsWith(':') || !name.endsWith(':') || name.length <= 2)
      return null

    const shortcode = name.slice(1, -1)
    const backendUrl =
      notification.appIndex == null
        ? undefined
        : apps[notification.appIndex]?.backendUrl

    if (backendUrl) {
      const catalog = emojiCatalog.get(backendUrl)
      if (catalog) {
        const found = catalog.find((e) => e.shortcode === shortcode)
        if (found) return found.url
      }
    }

    // フォールバック: デフォルト EmojiContext
    const fallbackFound = emojiFallback.find((e) => e.shortcode === shortcode)
    if (fallbackFound) return fallbackFound.url

    // Misskey URL パターンフォールバック
    if (backendUrl) {
      return `${backendUrl}/emoji/${encodeURIComponent(shortcode)}.webp`
    }

    return null
  }, [
    notification.reaction,
    notification.appIndex,
    apps,
    emojiCatalog,
    emojiFallback,
  ])

  const displayName = useMemo(() => {
    if (notification.account == null) return ''
    return formatDisplayNameHtml(notification.account)
  }, [notification.account])

  const openAccountDetail = () => {
    if (notification.account == null) return
    setDetail({
      content: {
        ...notification.account,
        appIndex: notification.appIndex,
      },
      type: 'Account',
    })
  }

  const handleAccountKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    openAccountDetail()
  }

  switch (notification.type) {
    case 'poll_expired':
      return (
        <div className="ml-1 mt-2 box-border min-w-0 max-w-full overflow-x-hidden border-b-2 border-l-2 border-teal-300 pl-2">
          {notification.status != null && (
            <Status
              scrolling={scrolling}
              status={{
                ...notification.status,
                appIndex: notification.appIndex,
              }}
            />
          )}
        </div>
      )
    case 'mention':
    case 'status':
      return (
        <div className="ml-1 mt-2 box-border min-w-0 max-w-full overflow-x-hidden border-b-2 border-l-2 border-green-500 pl-2">
          {notification.status != null && (
            <Status
              scrolling={scrolling}
              status={{
                ...notification.status,
                appIndex: notification.appIndex,
              }}
            />
          )}
        </div>
      )
    case 'reblog':
      return (
        <div className="ml-1 mt-2 box-border min-w-0 max-w-full overflow-x-hidden border-b-2 border-l-2 border-blue-500 pl-2">
          <h3 className="min-w-0 max-w-full">
            <button
              className="flex w-full min-w-0 max-w-full cursor-pointer appearance-none border-0 bg-transparent p-0 text-left text-inherit"
              onClick={openAccountDetail}
              onKeyDown={handleAccountKeyDown}
              type="button"
            >
              {scrolling ? (
                <AvatarPlaceholder />
              ) : (
                <ProxyImage
                  alt="avatar"
                  className="h-12 w-12 flex-none rounded-lg object-contain"
                  disableContextMenu
                  height={48}
                  src={notification.account?.avatar ?? ''}
                  width={48}
                />
              )}
              <span className="min-w-0 w-0 flex-1 overflow-hidden pl-2">
                <TruncatedDisplayName
                  flexItem={false}
                  html={displayName}
                  title={notification.account?.display_name}
                />
                <span
                  className="block w-full truncate text-gray-300"
                  title={`@${notification.account?.acct ?? ''}`}
                >
                  @{notification.account?.acct ?? ''}
                </span>
              </span>
            </button>
          </h3>
          {notification.status != null && (
            <Status
              scrolling={scrolling}
              small
              status={{
                ...notification.status,
                appIndex: notification.appIndex,
              }}
            />
          )}
        </div>
      )
    case 'favourite':
      return (
        <div className="ml-1 mt-2 box-border min-w-0 max-w-full overflow-x-hidden border-b-2 border-l-2 border-orange-300 pl-2">
          <h3 className="min-w-0 max-w-full">
            <button
              className="flex w-full min-w-0 max-w-full cursor-pointer appearance-none border-0 bg-transparent p-0 text-left text-inherit"
              onClick={openAccountDetail}
              onKeyDown={handleAccountKeyDown}
              type="button"
            >
              {scrolling ? (
                <AvatarPlaceholder />
              ) : (
                <ProxyImage
                  alt="avatar"
                  className="h-12 w-12 flex-none rounded-lg object-contain"
                  disableContextMenu
                  height={48}
                  src={notification.account?.avatar ?? ''}
                  width={48}
                />
              )}
              <span className="min-w-0 w-0 flex-1 overflow-hidden pl-2">
                <TruncatedDisplayName
                  flexItem={false}
                  html={displayName}
                  title={notification.account?.display_name}
                />
                <span
                  className="block w-full truncate text-gray-300"
                  title={`@${notification.account?.acct ?? ''}`}
                >
                  @{notification.account?.acct ?? ''}
                </span>
              </span>
            </button>
          </h3>
          <div>
            <RiStarFill className="text-4xl text-orange-300" />
          </div>
          {notification.status != null && (
            <Status
              scrolling={scrolling}
              small
              status={{
                ...notification.status,
                appIndex: notification.appIndex,
              }}
            />
          )}
        </div>
      )
    case 'emoji_reaction':
      return (
        <div className="ml-1 mt-2 box-border min-w-0 max-w-full overflow-x-hidden border-b-2 border-l-2 border-orange-300 pl-2">
          <h3 className="flex min-w-0 max-w-full items-start gap-2">
            <button
              className="flex min-w-0 w-0 flex-1 max-w-full cursor-pointer appearance-none border-0 bg-transparent p-0 text-left text-inherit"
              onClick={openAccountDetail}
              onKeyDown={handleAccountKeyDown}
              type="button"
            >
              {scrolling ? (
                <AvatarPlaceholder />
              ) : (
                <ProxyImage
                  alt="avatar"
                  className="h-12 w-12 flex-none rounded-lg object-contain"
                  disableContextMenu
                  height={48}
                  src={notification.account?.avatar ?? ''}
                  width={48}
                />
              )}
              <span className="min-w-0 w-0 flex-1 overflow-hidden pl-2">
                <TruncatedDisplayName
                  flexItem={false}
                  html={displayName}
                  title={notification.account?.display_name}
                />
                <span
                  className="block w-full truncate text-gray-300"
                  title={`@${notification.account?.acct ?? ''}`}
                >
                  @{notification.account?.acct ?? ''}
                </span>
              </span>
            </button>
            <div className="mr-2 w-12 shrink-0">
              <ReactionDisplay
                reactionName={notification.reaction?.name}
                resolvedReactionUrl={resolvedReactionUrl}
                scrolling={scrolling}
              />
            </div>
          </h3>
          {notification.status != null && (
            <Status
              scrolling={scrolling}
              small
              status={{
                ...notification.status,
                appIndex: notification.appIndex,
              }}
            />
          )}
        </div>
      )
    case 'follow':
      return (
        <div className="ml-1 mt-2 box-border min-w-0 max-w-full overflow-x-hidden border-b-2 border-l-2 border-pink-300 pl-2">
          <p>Follow</p>
          <h3 className="min-w-0 max-w-full">
            <button
              className="flex w-full min-w-0 max-w-full cursor-pointer appearance-none border-0 bg-transparent p-0 text-left text-inherit"
              onClick={openAccountDetail}
              onKeyDown={handleAccountKeyDown}
              type="button"
            >
              {scrolling ? (
                <AvatarPlaceholder />
              ) : (
                <ProxyImage
                  alt="avatar"
                  className="h-12 w-12 flex-none rounded-lg object-contain"
                  disableContextMenu
                  height={48}
                  src={notification.account?.avatar ?? ''}
                  width={48}
                />
              )}
              <span className="min-w-0 w-0 flex-1 overflow-hidden pl-2">
                <TruncatedDisplayName
                  flexItem={false}
                  html={displayName}
                  title={notification.account?.display_name}
                />
                <span
                  className="block w-full truncate text-gray-300"
                  title={`@${notification.account?.acct ?? ''}`}
                >
                  @{notification.account?.acct ?? ''}
                </span>
              </span>
            </button>
          </h3>
        </div>
      )
    case 'follow_request':
      return (
        <div className="ml-1 mt-2 box-border min-w-0 max-w-full overflow-x-hidden border-b-2 border-l-2 border-pink-500 pl-2">
          <p>Follow request</p>
          <h3 className="min-w-0 max-w-full">
            <button
              className="flex w-full min-w-0 max-w-full cursor-pointer appearance-none border-0 bg-transparent p-0 text-left text-inherit"
              onClick={openAccountDetail}
              onKeyDown={handleAccountKeyDown}
              type="button"
            >
              {scrolling ? (
                <AvatarPlaceholder />
              ) : (
                <ProxyImage
                  alt="avatar"
                  className="h-12 w-12 flex-none rounded-lg object-contain"
                  disableContextMenu
                  height={48}
                  src={notification.account?.avatar ?? ''}
                  width={48}
                />
              )}
              <span className="min-w-0 w-0 flex-1 overflow-hidden pl-2">
                <TruncatedDisplayName
                  flexItem={false}
                  html={displayName}
                  title={notification.account?.display_name}
                />
                <span
                  className="block w-full truncate text-gray-300"
                  title={`@${notification.account?.acct ?? ''}`}
                >
                  @{notification.account?.acct ?? ''}
                </span>
              </span>
            </button>
          </h3>
        </div>
      )
    default:
      return <div>Unknown notification type</div>
  }
}
