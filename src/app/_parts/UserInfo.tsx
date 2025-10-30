/* eslint-disable @next/next/no-img-element */
'use client'

import { Visibility } from 'app/_parts/Visibility'

import type { Entity } from 'megalodon'
import { useContext, useMemo } from 'react'
import { RiRobotFill } from 'react-icons/ri'
import type { AccountAddAppIndex } from 'types/types'
import { SetDetailContext } from 'util/provider/DetailProvider'

export const UserInfo = ({
  account,
  visibility,
  small = false,
  scrolling = false,
}: {
  account: AccountAddAppIndex
  visibility?: Entity.StatusVisibility
  small?: boolean
  scrolling?: boolean
}) => {
  const setDetail = useContext(SetDetailContext)
  const getDisplayName = useMemo(() => {
    let displayName = account.display_name
    if (account.emojis.length > 0) {
      account.emojis.forEach((emoji) => {
        displayName = displayName.replace(
          new RegExp(`:${emoji.shortcode}:`, 'gm'),
          `<img src="${emoji.url}" alt="${emoji.shortcode}" class="min-w-5 h-5 inline-block" loading="lazy" />`,
        )
      })
    }
    return displayName
  }, [account])

  return (
    <h3
      className="flex"
      onClick={() => {
        setDetail({
          content: account,
          type: 'Account',
        })
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setDetail({
            content: account,
            type: 'Account',
          })
        }
      }}
    >
      <div className="relative">
        {scrolling ? (
          <div
            className={[
              'rounded-lg object-contain flex-none bg-gray-600',
              small ? 'w-6 h-6' : 'w-12 h-12',
            ].join(' ')}
          />
        ) : (
          <img
            alt="avatar"
            className={[
              'rounded-lg object-contain flex-none',
              small ? 'w-6 h-6' : 'w-12 h-12',
            ].join(' ')}
            loading="lazy"
            src={account.avatar}
          />
        )}
        {account.bot === true && (
          <RiRobotFill
            className={[
              'absolute text-blue-400 bg-gray-800 rounded-full p-0.5 bottom-0 right-0',
              small ? 'w-3 h-3' : 'w-4 h-4',
            ].join(' ')}
            size={small ? 8 : 10}
            title="Bot"
          />
        )}
      </div>
      {small ? (
        <div className="w-[calc(100%-24px)] pl-2">
          <div className="flex w-full justify-between truncate">
            <p>
              <span>
                <span
                  dangerouslySetInnerHTML={{
                    __html: getDisplayName,
                  }}
                />
              </span>
              <span className="pl-1 text-gray-300">@{account.acct}</span>
            </p>
            <Visibility visibility={visibility} />
          </div>
        </div>
      ) : (
        <div className="w-[calc(100%-46px)] pl-2">
          <p className="flex w-full justify-between [&>span]:inline-block">
            <span
              className="truncate"
              dangerouslySetInnerHTML={{
                __html: getDisplayName,
              }}
            />
            <Visibility visibility={visibility} />
          </p>
          <p className="truncate text-gray-300" title={`@${account.acct}`}>
            @{account.acct}
          </p>
        </div>
      )}
    </h3>
  )
}
