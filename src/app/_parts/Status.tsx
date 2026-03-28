/* eslint-disable @next/next/no-img-element */
'use client'

import { Actions } from 'app/_parts/Actions'
import { Card } from 'app/_parts/Card'
import { EditedAt } from 'app/_parts/EditedAt'
import { EmojiReactions } from 'app/_parts/EmojiReactions'
import { MediaAttachments } from 'app/_parts/MediaAttachments'
import { Poll } from 'app/_parts/Poll'
import { UserInfo } from 'app/_parts/UserInfo'
import { ElementType } from 'domelementtype'
import parse, {
  attributesToProps,
  type DOMNode,
  domToReact,
} from 'html-react-parser'
import type { Entity } from 'megalodon'
import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { RiRepeatFill, RiVideoLine } from 'react-icons/ri'
import type { PollAddAppIndex, StatusAddAppIndex } from 'types/types'
import { canPlay } from 'util/PlayerUtils'
import { AppsContext } from 'util/provider/AppsProvider'
import { SetDetailContext } from 'util/provider/DetailProvider'
import { SetPlayerContext } from 'util/provider/PlayerProvider'
import {
  EmojiCatalogContext,
  EmojiContext,
} from 'util/provider/ResourceProvider'

export const Status = ({
  status,
  className = '',
  small = false,
  scrolling = false,
}: {
  status: StatusAddAppIndex
  className?: string
  small?: boolean
  scrolling?: boolean
}) => {
  const setDetail = useContext(SetDetailContext)
  const setPlayer = useContext(SetPlayerContext)
  const apps = useContext(AppsContext)
  const emojiCatalog = useContext(EmojiCatalogContext)
  const emojiFallback = useContext(EmojiContext)

  const [localReactions, setLocalReactions] = useState<Entity.Reaction[]>(
    (status.reblog?.emoji_reactions ?? status.emoji_reactions) || [],
  )

  useEffect(() => {
    setLocalReactions(
      (status.reblog?.emoji_reactions ?? status.emoji_reactions) || [],
    )
  }, [status.emoji_reactions, status.reblog?.emoji_reactions])

  // status が属するサーバの絵文字一覧を取得（カタログ優先、フォールバックで旧 EmojiContext）
  const serverEmojis = useMemo(() => {
    const backendUrl =
      status.appIndex != null ? apps[status.appIndex]?.backendUrl : undefined
    if (backendUrl) {
      const catalog = emojiCatalog.get(backendUrl)
      if (catalog && catalog.length > 0) return catalog
    }
    return emojiFallback
  }, [status.appIndex, apps, emojiCatalog, emojiFallback])

  const handleReactionAdd = useCallback(
    (emoji: string) => {
      setLocalReactions((prev) => {
        const isCustom = emoji.startsWith(':') && emoji.endsWith(':')
        const name = isCustom ? emoji.slice(1, -1) : emoji

        const existing = prev.find((r) => r.name === name)
        if (existing) {
          if (existing.me) return prev
          return prev.map((r) =>
            r.name === name ? { ...r, count: r.count + 1, me: true } : r,
          )
        }

        let url: string | undefined
        let static_url: string | undefined
        if (isCustom) {
          const found = serverEmojis.find((e) => e.shortcode === name)
          if (found) {
            url = found.url
            static_url = found.static_url
          }
        }

        return [...prev, { count: 1, me: true, name, static_url, url }]
      })
    },
    [serverEmojis],
  )

  const handleReactionToggle = useCallback(
    (reactionName: string, currentlyMine: boolean) => {
      setLocalReactions((prev) => {
        if (currentlyMine) {
          return prev
            .map((r) =>
              r.name === reactionName
                ? { ...r, count: Math.max(0, r.count - 1), me: false }
                : r,
            )
            .filter((r) => r.count > 0)
        }
        return prev.map((r) =>
          r.name === reactionName ? { ...r, count: r.count + 1, me: true } : r,
        )
      })
    },
    [],
  )

  const getDisplayName = useCallback((account: Entity.Account) => {
    let displayName = account.display_name
    if (account.emojis.length > 0) {
      account.emojis.forEach((emoji) => {
        displayName = displayName.replace(
          new RegExp(`:${emoji.shortcode}:`, 'gm'),
          `<img src="${emoji.url}" alt="${emoji.shortcode}" title=":${emoji.shortcode}:" class="min-w-7 h-7 inline-block" loading="lazy" />`,
        )
      })
    }
    return displayName
  }, [])

  const displayName = useMemo(
    () => getDisplayName(status.account),
    [status.account, getDisplayName],
  )

  const getSpoilerText = useCallback((status: Entity.Status) => {
    let spoiler_text = status.spoiler_text
    if (status.emojis.length > 0) {
      status.emojis.forEach((emoji) => {
        spoiler_text = spoiler_text.replace(
          new RegExp(`:${emoji.shortcode}:`, 'gm'),
          `<img src="${emoji.url}" alt="${emoji.shortcode}" title=":${emoji.shortcode}:" class="min-w-7 h-7 inline-block" loading="lazy" />`,
        )
      })
    }

    return spoiler_text
  }, [])

  const spoilerText = useMemo(
    () => getSpoilerText(status.reblog ?? status),
    [status.reblog, status, getSpoilerText],
  )

  const getContentFormatted = useCallback((status: Entity.Status) => {
    let content = status.content
    if (status.emojis.length > 0) {
      status.emojis.forEach((emoji) => {
        content = content.replace(
          new RegExp(`:${emoji.shortcode}:`, 'gm'),
          `<img src="${emoji.url}" alt="${emoji.shortcode}" title=":${emoji.shortcode}:" class="min-w-7 h-7 inline-block" loading="lazy" />`,
        )
      })
    }

    return content
  }, [])

  const contentFormatted = useMemo(
    () => getContentFormatted(status.reblog ?? status),
    [status, getContentFormatted],
  )

  const replace = (node: DOMNode) => {
    if (node.type === ElementType.Tag && node.name === 'a') {
      const classNames = (node.attribs.class ?? '').split(' ')
      if (
        classNames.includes('mention') &&
        (!node.attribs.rel || node.attribs.rel !== 'tag')
      ) {
        return (
          <a
            {...attributesToProps(node.attribs)}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              const href = node.attribs.href ?? ''
              const mention = status.mentions.find((m) => m.url === href)
              // id が取得できた場合は getAccount で解決、なければ acct でフォールバック
              const mentionByPattern = status.mentions.find(
                (m) =>
                  href.includes(`/@${m.acct}`) ||
                  href.includes(`/users/${m.acct}`) ||
                  // リモートユーザー: acct が user@domain の場合、href に /@user が含まれるか
                  (m.acct.includes('@') &&
                    href.includes(`/@${m.acct.split('@')[0]}`)),
              )
              const content =
                mention?.id || mention?.acct || mentionByPattern?.acct || href
              setDetail({
                appIndex: status.appIndex,
                content,
                type: 'SearchUser',
              })
            }}
            rel={[node.attribs.rel, 'noopener noreferrer'].join(' ')}
            target="_blank"
          >
            {domToReact(node.children as DOMNode[])}
          </a>
        )
      }
      if (
        node.attribs.rel === 'tag' ||
        (node.children[0]?.type === ElementType.Text &&
          node.children[0]?.data?.startsWith('#'))
      ) {
        return (
          <a
            {...attributesToProps(node.attribs)}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              setDetail({
                content: status.tags.find(
                  (tag) =>
                    e.currentTarget.innerText.toLocaleLowerCase() ===
                    `#${tag.name.toLocaleLowerCase()}`,
                )?.name as string,
                type: 'Hashtag',
              })
            }}
            rel={[node.attribs.rel, 'noopener noreferrer'].join(' ')}
            target="_blank"
            title={`#${node.attribs.href}`}
          >
            {domToReact(node.children as DOMNode[])}
          </a>
        )
      }

      if (canPlay(node.attribs.href)) {
        return (
          <a
            {...attributesToProps(node.attribs)}
            className="line-clamp-2 break-all"
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
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
                    url: node.attribs.href,
                  },
                ],
                index: 0,
              })
            }}
            rel={[node.attribs.rel, 'noopener noreferrer'].join(' ')}
            target="_blank"
          >
            <RiVideoLine className="mr-1 inline-block" />
            {domToReact(node.children as DOMNode[])}
          </a>
        )
      }

      return (
        <a
          {...attributesToProps(node.attribs)}
          className="line-clamp-1"
          rel={[node.attribs.rel, 'noopener noreferrer'].join(' ')}
          target="_blank"
          title={node.attribs.href}
        >
          {domToReact(node.children as DOMNode[])}
        </a>
      )
    }
  }

  const statusClasses = [
    'box-border',
    'w-full',
    'p-2',
    'leading-7',
    className,
    small ? 'max-h-24 overflow-clip' : '',
    status.reblog != null ? 'border-l-4 border-blue-400 pl-2 mb-2' : '',
  ].join(' ')

  const poll = status.reblog?.poll ?? status.poll
  const pollAddAppIndex =
    poll != null
      ? {
          ...poll,
          appIndex: status.appIndex,
        }
      : null

  return (
    <div className={statusClasses}>
      {status.reblog != null ? (
        <>
          <div
            className="flex mb-1 overflow-clip"
            onClick={() => {
              setDetail({
                content: {
                  ...status.account,
                  appIndex: status.appIndex,
                },
                type: 'Account',
              })
            }}
          >
            <RiRepeatFill
              className="mr-2 block text-blue-400 flex-none"
              size={24}
            />
            <img
              alt="avatar"
              className={[
                'rounded-lg object-contain flex-none block shrink-0',
                small ? 'w-3 h-3' : 'w-6 h-6',
              ].join(' ')}
              loading="lazy"
              src={status.account.avatar}
            />
            <div
              className="pl-2 whitespace-nowrap"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: TODO
              dangerouslySetInnerHTML={{
                __html: displayName,
              }}
            />
          </div>
          <UserInfo
            account={{
              ...status.reblog.account,
              appIndex: status.appIndex,
            }}
            scrolling={scrolling}
            small={small}
            visibility={status.reblog.visibility}
          />
        </>
      ) : (
        <UserInfo
          account={{
            ...status.account,
            appIndex: status.appIndex,
          }}
          scrolling={scrolling}
          small={small}
          visibility={status.visibility}
        />
      )}
      {(status.reblog?.spoiler_text ?? status.spoiler_text) !== '' && (
        <div className="border-b-2 border-b-gray-600 py-2 text-gray-400">
          {parse(spoilerText, {
            replace,
          })}
        </div>
      )}
      <div
        className="content"
        onClick={() => {
          setDetail({
            content: status,
            type: 'Status',
          })
        }}
      >
        <EditedAt editedAt={status.edited_at} />
        {parse(contentFormatted, { replace })}
      </div>

      <Poll
        poll={
          pollAddAppIndex as
            | (PollAddAppIndex & {
                own_votes: number[] | undefined
              })
            | null
        }
      />

      {(status.reblog?.media_attachments ?? status.media_attachments).length ===
        0 && <Card card={status.reblog?.card ?? status.card} />}

      <MediaAttachments
        mediaAttachments={
          status.reblog?.media_attachments ?? status.media_attachments
        }
        scrolling={scrolling}
        sensitive={status.reblog?.sensitive ?? status.sensitive}
      />
      <EmojiReactions
        onToggle={handleReactionToggle}
        reactions={localReactions}
        status={status}
      />
      <Actions onReactionAdd={handleReactionAdd} status={status} />
    </div>
  )
}
