/* eslint-disable @next/next/no-img-element */
'use client'

import { ProxyImage } from 'app/_parts/ProxyImage'
import { Visibility } from 'app/_parts/Visibility'

import parse from 'html-react-parser'
import type { Entity } from 'megalodon'
import { useContext, useMemo } from 'react'
import { RiRobotFill } from 'react-icons/ri'
import type { AccountAddAppIndex } from 'types/types'
import { replaceEmojis } from 'util/emojiReplacer'
import { escapeHtml } from 'util/escapeHtml'
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
  const getDisplayName = useMemo(
    () =>
      replaceEmojis(
        escapeHtml(account.display_name),
        account.emojis,
        'min-w-5 h-5 inline-block',
      ),
    [account],
  )

  const openAccountDetail = () => {
    setDetail({
      content: account,
      type: 'Account',
    })
  }

  return (
    <h3 className="flex">
      <button
        className="flex w-full border-0 bg-transparent p-0 text-left font-[inherit] text-inherit"
        onClick={openAccountDetail}
        type="button"
      >
        <span className="relative block flex-none">
          {scrolling ? (
            <span
              className={[
                'block rounded-lg object-contain flex-none bg-gray-600',
                small ? 'w-6 h-6' : 'w-12 h-12',
              ].join(' ')}
            />
          ) : (
            <ProxyImage
              alt="avatar"
              className={[
                'rounded-lg object-contain flex-none',
                small ? 'w-6 h-6' : 'w-12 h-12',
              ].join(' ')}
              height={small ? 24 : 48}
              src={account.avatar}
              width={small ? 24 : 48}
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
        </span>
        {small ? (
          <span className="block w-[calc(100%-24px)] pl-2">
            <span className="flex w-full justify-between truncate">
              <span>
                <span>{parse(getDisplayName)}</span>
                <span className="pl-1 text-gray-300">@{account.acct}</span>
              </span>
              <Visibility visibility={visibility} />
            </span>
          </span>
        ) : (
          <span className="block w-[calc(100%-46px)] pl-2">
            <span className="flex w-full justify-between [&>span]:inline-block">
              <span className="truncate">{parse(getDisplayName)}</span>
              <Visibility visibility={visibility} />
            </span>
            <span
              className="block truncate text-gray-300"
              title={`@${account.acct}`}
            >
              @{account.acct}
            </span>
          </span>
        )}
      </button>
    </h3>
  )
}
