/* eslint-disable @next/next/no-img-element */
'use client'

import { ProxyImage } from 'app/_parts/ProxyImage'
import { TruncatedDisplayName } from 'app/_parts/TruncatedDisplayName'
import { Visibility } from 'app/_parts/Visibility'

import parse from 'html-react-parser'
import type { Entity } from 'megalodon'
import { useContext, useMemo } from 'react'
import { RiRobotFill } from 'react-icons/ri'
import type { AccountAddAppIndex } from 'types/types'
import { formatDisplayNameHtml } from 'util/formatDisplayName'
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
  const displayName = useMemo(() => formatDisplayNameHtml(account), [account])

  const openAccountDetail = () => {
    setDetail({
      content: account,
      type: 'Account',
    })
  }

  return (
    <h3 className="min-w-0 max-w-full">
      <button
        className="block w-full min-w-0 max-w-full border-0 bg-transparent p-0 text-left font-[inherit] text-inherit"
        onClick={openAccountDetail}
        type="button"
      >
        <span className="flex w-full min-w-0 max-w-full items-start overflow-hidden">
          <span className="relative block shrink-0">
            {scrolling ? (
              <span
                className={[
                  'block rounded-lg bg-gray-600 object-contain',
                  small ? 'h-6 w-6' : 'h-12 w-12',
                ].join(' ')}
              />
            ) : (
              <ProxyImage
                alt="avatar"
                className={[
                  'rounded-lg object-contain',
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
            <span className="min-w-0 w-0 flex-1 overflow-hidden pl-2">
              <span className="flex w-full min-w-0 items-center justify-between gap-1">
                <TruncatedDisplayName title={account.display_name}>
                  {parse(displayName)}
                  <span className="pl-1 text-gray-300">@{account.acct}</span>
                </TruncatedDisplayName>
                <span className="shrink-0">
                  <Visibility visibility={visibility} />
                </span>
              </span>
            </span>
          ) : (
            <span className="min-w-0 w-0 flex-1 overflow-hidden pl-2">
              <span className="flex w-full min-w-0 items-center justify-between gap-1">
                <TruncatedDisplayName
                  html={displayName}
                  title={account.display_name}
                />
                <span className="shrink-0">
                  <Visibility visibility={visibility} />
                </span>
              </span>
              <span
                className="block truncate text-gray-300"
                title={`@${account.acct}`}
              >
                @{account.acct}
              </span>
            </span>
          )}
        </span>
      </button>
    </h3>
  )
}
