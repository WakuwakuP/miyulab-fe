/* eslint-disable @next/next/no-img-element */
'use client'

import { useContext, useState } from 'react'

import { ElementType } from 'domelementtype'
import parse, {
  DOMNode,
  attributesToProps,
  domToReact,
} from 'html-react-parser'
import { Entity } from 'megalodon'
import { RiRepeatFill } from 'react-icons/ri'

import { Actions } from 'app/_parts/Actions'
import { Card } from 'app/_parts/Card'
import { EditedAt } from 'app/_parts/EditedAt'
import { Media } from 'app/_parts/Media'
import { Poll } from 'app/_parts/Poll'
import { UserInfo } from 'app/_parts/UserInfo'
import { SetDetailContext } from 'util/provider/DetailProvider'
import { SettingContext } from 'util/provider/SettingProvider'

export const Status = ({
  status,
  className = '',
  small = false,
}: {
  status: Entity.Status
  className?: string
  small?: boolean
}) => {
  const setDetail = useContext(SetDetailContext)
  const setting = useContext(SettingContext)

  const [isShowSensitive, setIsShowSensitive] =
    useState<boolean>(setting.showSensitive)

  const getDisplayName = (account: Entity.Account) => {
    let displayName = account.display_name
    if (account.emojis.length > 0) {
      account.emojis.forEach((emoji) => {
        displayName = displayName.replace(
          new RegExp(`:${emoji.shortcode}:`, 'gm'),
          `<img src="${emoji.url}" alt="${emoji.shortcode}" class="min-w-5 h-5 inline-block" />`
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
          `<img src="${emoji.url}" alt="${emoji.shortcode}" class="min-w-5 h-5 inline-block" />`
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
      if (node.attribs.rel === 'tag') {
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

      return (
        <a
          {...attributesToProps(node.attribs)}
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
          />
        </>
      ) : (
        <UserInfo
          account={status.account}
          visibility={status.visibility}
          small={small}
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
          status.poll as
            | (Entity.Poll & {
                own_votes: number[] | undefined
              })
            | null
        }
      />

      {status.media_attachments.length > 0 ? (
        <div className="relative flex flex-wrap">
          {(status.reblog?.sensitive ??
            status.sensitive) && (
            <>
              {!isShowSensitive ? (
                <div
                  className="absolute z-10 flex h-full w-full cursor-pointer items-center justify-center bg-gray-800/50 p-2 text-gray-400 backdrop-blur-lg"
                  onClick={() => {
                    setIsShowSensitive(true)
                  }}
                >
                  <div>Contents Warning</div>
                </div>
              ) : (
                <button
                  className="absolute left-2 top-2 z-10 rounded-md bg-gray-500/50 px-1 py-0.5"
                  onClick={() => setIsShowSensitive(false)}
                >
                  <div>Hide</div>
                </button>
              )}
            </>
          )}

          {status.media_attachments.map(
            (media: Entity.Attachment) => {
              switch (status.media_attachments.length) {
                case 1:
                  return (
                    <Media
                      key={media.id}
                      media={media}
                    />
                  )
                case 2:
                  return (
                    <Media
                      className="w-1/2"
                      key={media.id}
                      media={media}
                    />
                  )
                default:
                  return (
                    <Media
                      className="w-1/3"
                      key={media.id}
                      media={media}
                    />
                  )
              }
            }
          )}
        </div>
      ) : (
        <Card card={status.reblog?.card ?? status.card} />
      )}
      <Actions status={status} />
    </div>
  )
}
