/* eslint-disable @next/next/no-img-element */
'use client'

import { useContext } from 'react'

import { ElementType } from 'domelementtype'
import parse, {
  DOMNode,
  attributesToProps,
  domToReact,
} from 'html-react-parser'
import { Entity } from 'megalodon'
import { RiRepeatFill, RiVideoLine } from 'react-icons/ri'
import ReactPlayer from 'react-player'

import { Actions } from 'app/_parts/Actions'
import { Card } from 'app/_parts/Card'
import { EditedAt } from 'app/_parts/EditedAt'
import { MediaAttachments } from 'app/_parts/MediaAttachments'
import { Poll } from 'app/_parts/Poll'
import { UserInfo } from 'app/_parts/UserInfo'
import { SetDetailContext } from 'util/provider/DetailProvider'
import { SetPlayerContext } from 'util/provider/PlayerProvider'

export const Status = ({
  status,
  className = '',
  small = false,
  scrolling = false,
}: {
  status: Entity.Status
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
          `<img src="${emoji.url}" alt="${emoji.shortcode}" class="min-w-5 h-5 inline-block" loading="lazy" />`
        )
      })
    }
    return displayName
  }

  const getContentFormatted = (status: Entity.Status) => {
    let content = status.content
    if (status.emojis.length > 0) {
      status.emojis.forEach((emoji) => {
        content = content.replace(
          new RegExp(`:${emoji.shortcode}:`, 'gm'),
          `<img src="${emoji.url}" alt="${emoji.shortcode}" class="min-w-5 h-5 inline-block" loading="lazy" />`
        )
      })
    }

    return content
  }
  const replace = (node: DOMNode) => {
    if (
      node.type === ElementType.Tag &&
      node.name === 'a'
    ) {
      const classNames = (node.attribs.class ?? '').split(
        ' '
      )
      if (classNames.includes('mention')) {
        return (
          <a
            {...attributesToProps(node.attribs)}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              setDetail({
                type: 'SearchUser',
                content: status.mentions.find(
                  (mention) =>
                    mention.url === node.attribs.href
                )?.id as string,
              })
            }}
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
                type: 'Hashtag',
                content: status.tags.find(
                  (tag) =>
                    e.currentTarget.innerText.toLocaleLowerCase() ==
                    `#${tag.name.toLocaleLowerCase()}`
                )?.name as string,
              })
            }}
            target="_blank"
          >
            {domToReact(node.children as DOMNode[])}
          </a>
        )
      }

      if (ReactPlayer.canPlay(node.attribs.href)) {
        return (
          <>
            <a
              {...attributesToProps(node.attribs)}
              className="line-clamp-2 break-all"
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                setPlayer({
                  attachment: [
                    {
                      id: '',
                      url: node.attribs.href,
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
              }}
              rel={[
                node.attribs.rel,
                'noopener noreferrer',
              ].join(' ')}
              target="_blank"
            >
              <RiVideoLine className="mr-1 inline-block" />
              {domToReact(node.children as DOMNode[])}
            </a>
          </>
        )
      }

      return (
        <a
          {...attributesToProps(node.attribs)}
          className="line-clamp-1"
          title={node.attribs.href}
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

  const statusClasses = [
    'box-border',
    'w-full',
    'p-2',
    className,
    small ? 'max-h-24 overflow-clip' : '',
    status.reblog != null
      ? 'border-l-4 border-blue-400 pl-2 mb-2'
      : '',
  ].join(' ')

  return (
    <div className={statusClasses}>
      {status.reblog != null ? (
        <>
          <div
            className="mb-1"
            onClick={() => {
              setDetail({
                type: 'Account',
                content: status.account,
              })
            }}
          >
            <RiRepeatFill
              size={24}
              className="mr-2 inline-block text-blue-400"
            />
            <img
              className={[
                'rounded-lg object-contain flex-none inline-block',
                small ? 'w-3 h-3' : 'w-6 h-6',
              ].join(' ')}
              src={status.account.avatar}
              alt="avatar"
              loading="lazy"
            />
            <span
              className="pl-2"
              dangerouslySetInnerHTML={{
                __html: getDisplayName(status.account),
              }}
            />
          </div>
          <UserInfo
            account={status.reblog.account}
            visibility={status.reblog.visibility}
            small={small}
            scrolling={scrolling}
          />
        </>
      ) : (
        <UserInfo
          account={status.account}
          visibility={status.visibility}
          small={small}
          scrolling={scrolling}
        />
      )}
      {status.spoiler_text !== '' && (
        <div className="border-b-2 border-b-gray-600 py-2 text-gray-400">
          {status.spoiler_text}
        </div>
      )}
      <div
        className="content"
        onClick={() => {
          setDetail({
            type: 'Status',
            content: status,
          })
        }}
      >
        <EditedAt editedAt={status.edited_at} />
        {parse(
          getContentFormatted(status.reblog ?? status),
          { replace }
        )}
      </div>

      <Poll
        poll={
          (status.reblog?.poll ?? status.poll) as
            | (Entity.Poll & {
                own_votes: number[] | undefined
              })
            | null
        }
      />

      {status.media_attachments.length == 0 && (
        <Card card={status.reblog?.card ?? status.card} />
      )}

      <MediaAttachments
        sensitive={
          status.reblog?.sensitive ?? status.sensitive
        }
        mediaAttachments={status.media_attachments}
        scrolling={scrolling}
      />
      <Actions status={status} />
    </div>
  )
}
