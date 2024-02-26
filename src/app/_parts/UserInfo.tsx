/* eslint-disable @next/next/no-img-element */
'use client'

import { useContext } from 'react'

import { Entity } from 'megalodon'

import { SetDetailContext } from 'util/provider/DetailProvider'

export const UserInfo = ({
  account,
  small = false,
}: {
  account: Entity.Account
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

  return (
    <h3
      className="flex"
      onClick={() => {
        setDetail({
          type: 'Account',
          content: account,
        })
      }}
    >
      <img
        className={[
          'rounded-lg object-contain flex-none',
          small ? 'w-6 h-6' : 'w-12 h-12',
        ].join(' ')}
        src={account.avatar}
        alt="avatar"
      />
      <div className="w-[calc(100%-56px)] pl-2">
        {small ? (
          <p className="w-full truncate">
            <span
              dangerouslySetInnerHTML={{
                __html: getDisplayName(account),
              }}
            />
            <span className="pl-1 text-gray-300">
              @{account.acct}
            </span>
          </p>
        ) : (
          <>
            <p
              className="w-full truncate"
              dangerouslySetInnerHTML={{
                __html: getDisplayName(account),
              }}
            />
            <p className="truncate text-gray-300">
              @{account.acct}
            </p>
          </>
        )}
      </div>
    </h3>
  )
}
