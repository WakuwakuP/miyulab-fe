/* eslint-disable @next/next/no-img-element */
'use client'

import { Actions } from 'app/_parts/Actions'
import { Card } from 'app/_parts/Card'
import { EditedAt } from 'app/_parts/EditedAt'
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
import { useContext, useMemo } from 'react'
import { RiRepeatFill, RiVideoLine } from 'react-icons/ri'
import type { PollAddAppIndex, StatusAddAppIndex } from 'types/types'
import { canPlay } from 'util/PlayerUtils'
import { SetDetailContext } from 'util/provider/DetailProvider'
import { SetPlayerContext } from 'util/provider/PlayerProvider'

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

  const getDisplayName = (account: Entity.Account) => {
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
  }

  const displayName = useMemo(
    () => getDisplayName(status.account),
    [status.account, getDisplayName],
  )

  const getSpoilerText = (status: Entity.Status) => {
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
  }

  const spoilerText = useMemo(
    () => getSpoilerText(status.reblog ?? status),
    [status, getSpoilerText],
  )

  const getContentFormatted = (status: Entity.Status) => {
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
  }

  const contentFormatted = useMemo(
    () => getContentFormatted(status.reblog ?? status),
    [status, getContentFormatted],
  )

  const replace = (node: DOMNode) => {
    if (node.type === ElementType.Tag && node.name === 'a') {
      const classNames = (node.attribs.class ?? '').split(' ')
      if (classNames.includes('mention')) {
        return (
          <a
            {...attributesToProps(node.attribs)}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              setDetail({
                appIndex: status.appIndex,
                content: status.mentions.find(
                  (mention) => mention.url === node.attribs.href,
                )?.id as string,
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setDetail({
                  content: {
                    ...status.account,
                    appIndex: status.appIndex,
                  },
                  type: 'Account',
                })
              }
            }}
            role="button"
            tabIndex={0}
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
      {status.spoiler_text !== '' && (
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
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setDetail({
              content: status,
              type: 'Status',
            })
          }
        }}
        role="button"
        tabIndex={0}
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

      {status.media_attachments.length === 0 && (
        <Card card={status.reblog?.card ?? status.card} />
      )}

      <MediaAttachments
        mediaAttachments={status.media_attachments}
        scrolling={scrolling}
        sensitive={status.reblog?.sensitive ?? status.sensitive}
      />
      <Actions status={status} />
    </div>
  )
}
