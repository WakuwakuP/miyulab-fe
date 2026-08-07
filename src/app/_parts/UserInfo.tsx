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
    <h3 className="flex min-w-0">
      <button
        className="flex w-full min-w-0 border-0 bg-transparent p-0 text-left font-[inherit] text-inherit"
        onClick={openAccountDetail}
        type="button"
      >
        <span className="relative block flex-none">
          {scrolling ? (
            <span
              className={[
                'block flex-none rounded-lg bg-gray-600 object-contain',
                small ? 'h-6 w-6' : 'h-12 w-12',
              ].join(' ')}
            />
          ) : (
            <ProxyImage
              alt="avatar"
              className={[
                'flex-none rounded-lg object-contain',
                small ? 'h-6 w-6' : 'h-12 w-12',
              ].join(' ')}
              height={small ? 24 : 48}
              src={account.avatar}
              width={small ? 24 : 48}
            />
          )}
          {account.bot === true && (
            <RiRobotFill
              className={[
                'absolute bottom-0 right-0 rounded-full bg-gray-800 p-0.5 text-blue-400',
                small ? 'h-3 w-3' : 'h-4 w-4',
              ].join(' ')}
              size={small ? 8 : 10}
              title="Bot"
            />
          )}
        </span>
        {small ? (
          <span className="block min-w-0 flex-1 pl-2">
            <span className="flex w-full justify-between truncate">
              <span className="min-w-0 truncate">
                <span>{parse(getDisplayName)}</span>
                <span className="pl-1 text-gray-300">@{account.acct}</span>
              </span>
              <Visibility visibility={visibility} />
            </span>
          </span>
        ) : (
          <span className="block min-w-0 flex-1 pl-2">
            <span className="flex w-full justify-between [&>span]:inline-block">
              <span className="min-w-0 truncate">{parse(getDisplayName)}</span>
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
