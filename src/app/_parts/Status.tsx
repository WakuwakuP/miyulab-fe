/* eslint-disable @next/next/no-img-element */
'use client'

import { useContext } from 'react'

import { Entity } from 'megalodon'

import { Actions } from 'app/_parts/Actions'
import { Media } from 'app/_parts/Media'
import { UserInfo } from 'app/_parts/UserInfo'
import { SetDetailContext } from 'util/provider/DetailProvider'

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

  const getDisplayName = (account: Entity.Account) => {
    let displayName = account.display_name
    if (account.emojis.length > 0) {
      account.emojis.forEach((emoji) => {
        displayName = displayName.replace(
          new RegExp(`:${emoji.shortcode}:`, 'gm'),
          `<img src="${emoji.url}" alt="${emoji.shortcode}" class="min-w-4 h-4 inline-block" />`
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
          `<img src="${emoji.url}" alt="${emoji.shortcode}" class="min-w-4 h-4 inline-block" />`
        )
      })
    }
    return content
  }

  const statusClasses = [
    'box-border',
    'w-full',
    'p-2',
    className,
    small ? 'max-h-24 overflow-clip' : '',
    status.reblog != null
      ? 'border-l-4 border-blue-400 pl-2'
      : '',
  ].join(' ')

  return (
    <div className={statusClasses}>
      {status.reblog != null ? (
        <>
          <div
            onClick={() => {
              setDetail({
                type: 'Account',
                content: status.account,
              })
            }}
          >
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
            small={small}
          />
        </>
      ) : (
        <UserInfo
          account={status.account}
          small={small}
        />
      )}
      <div
        onClick={() => {
          setDetail({
            type: 'Status',
            content: status,
          })
        }}
        className="content"
        dangerouslySetInnerHTML={{
          __html: getContentFormatted(status),
        }}
      />
      <div className="flex flex-wrap">
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
      <Actions status={status} />
    </div>
  )
}
