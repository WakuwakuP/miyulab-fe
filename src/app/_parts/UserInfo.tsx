/* eslint-disable @next/next/no-img-element */
'use client'

import { useContext } from 'react'

import { Entity } from 'megalodon'

import { Visibility } from 'app/_parts/Visibility'
import { SetDetailContext } from 'util/provider/DetailProvider'

export const UserInfo = ({
  account,
  visibility,
  small = false,
}: {
  account: Entity.Account
  visibility?: Entity.StatusVisibility
  small?: boolean
}) => {
  const setDetail = useContext(SetDetailContext)
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
        loading="lazy"
      />
      {small ? (
        <div className="w-[calc(100%-24px)] pl-2">
          <div className="flex w-full justify-between truncate">
            <p>
              <span
                dangerouslySetInnerHTML={{
                  __html: getDisplayName(account),
                }}
              />
              <span className="pl-1 text-gray-300">
                @{account.acct}
              </span>
            </p>
            <Visibility visibility={visibility} />
          </div>
        </div>
      ) : (
        <div className="w-[calc(100%-56px)] pl-2">
          <p className="flex w-full justify-between [&>span]:inline-block">
            <span
              className="truncate"
              dangerouslySetInnerHTML={{
                __html: getDisplayName(account),
              }}
            />
            <Visibility visibility={visibility} />
          </p>
          <p className="truncate text-gray-300">
            @{account.acct}
          </p>
        </div>
      )}
    </h3>
  )
}
