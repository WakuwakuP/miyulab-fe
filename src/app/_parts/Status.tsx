/* eslint-disable @next/next/no-img-element */
'use client'

import { useContext, useState } from 'react'

import { Entity } from 'megalodon'
import { RiRepeatFill } from 'react-icons/ri'

import { Actions } from 'app/_parts/Actions'
import { Media } from 'app/_parts/Media'
import { UserInfo } from 'app/_parts/UserInfo'
import { SetDetailContext } from 'util/provider/DetailProvider'
import { SettingContext } from 'util/provider/SettingProvider'

import { Poll } from './Poll'

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
        onClick={() => {
          setDetail({
            type: 'Status',
            content: status,
          })
        }}
        className="content"
        dangerouslySetInnerHTML={{
          __html: getContentFormatted(
            status.reblog ?? status
          ),
        }}
      />

      <Poll
        poll={
          status.poll as
            | (Entity.Poll & {
                own_votes: number[] | undefined
              })
            | null
        }
      />

      {status.media_attachments.length > 0 && (
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
      )}
      <Actions status={status} />
    </div>
  )
}
