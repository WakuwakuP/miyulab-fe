/* eslint-disable @next/next/no-img-element */
import { useContext } from 'react'

import { Entity } from 'megalodon'
import * as emoji from 'node-emoji'
import { RiStarFill } from 'react-icons/ri'

import { Status } from 'app/_parts/Status'
import { SetDetailContext } from 'util/provider/DetailProvider'

const AvatarPlaceholder = () => (
  <div className="h-12 w-12 flex-none rounded-lg bg-gray-600" />
)

export const Notification = ({
  notification,
  scrolling = false,
}: {
  notification: Entity.Notification
  scrolling?: boolean
}) => {
  const setDetail = useContext(SetDetailContext)

  switch (notification.type) {
    case 'poll_expired':
      return (
        <div className="ml-1 mt-2 box-border border-b-2 border-l-2 border-teal-300 pl-2">
          <Status
            status={notification.status as Entity.Status}
            scrolling={scrolling}
          />
        </div>
      )
    case 'mention':
      return (
        <div className="ml-1 mt-2 box-border border-b-2 border-l-2 border-green-500 pl-2">
          <Status
            status={notification.status as Entity.Status}
            scrolling={scrolling}
          />
        </div>
      )
    case 'reblog':
      return (
        <div className="ml-1 mt-2 box-border border-b-2 border-l-2 border-blue-500 pl-2">
          <h3
            className="flex"
            onClick={() => {
              if (notification.account == null) return
              setDetail({
                type: 'Account',
                content: notification.account,
              })
            }}
          >
            {scrolling ? (
              <AvatarPlaceholder />
            ) : (
              <img
                className="h-12 w-12 flex-none rounded-lg object-contain"
                src={notification.account?.avatar ?? ''}
                alt="avatar"
                loading="lazy"
              />
            )}
            <div className="w-[calc(100%-56px)] pl-2">
              <p className="w-full truncate">
                {notification.account?.display_name ?? ''}
              </p>
              <p className="w-full truncate text-gray-300">
                @{notification.account?.acct ?? ''}
              </p>
            </div>
          </h3>
          <Status
            status={notification.status as Entity.Status}
            scrolling={scrolling}
            small
          />
        </div>
      )
    case 'favourite':
      return (
        <div className="ml-1 mt-2 box-border border-b-2 border-l-2 border-orange-300 pl-2">
          <h3
            className="flex"
            onClick={() => {
              if (notification.account == null) return
              setDetail({
                type: 'Account',
                content: notification.account,
              })
            }}
          >
            {scrolling ? (
              <AvatarPlaceholder />
            ) : (
              <img
                className="h-12 w-12 flex-none rounded-lg object-contain"
                src={notification.account?.avatar ?? ''}
                alt="avatar"
                loading="lazy"
              />
            )}
            <div className="w-[calc(100%-56px)] pl-2">
              <p className="w-full truncate">
                {notification.account?.display_name ?? ''}
              </p>
              <p className="w-full truncate text-gray-300">
                @{notification.account?.acct ?? ''}
              </p>
            </div>
          </h3>
          <div>
            <RiStarFill className="text-3xl text-orange-300" />
          </div>
          <Status
            status={notification.status as Entity.Status}
            scrolling={scrolling}
            small
          />
        </div>
      )
    case 'reaction':
      return (
        <div className="ml-1 mt-2 box-border border-b-2 border-l-2 border-orange-300 pl-2">
          <h3>
            <div
              className="flex"
              onClick={() => {
                if (notification.account == null) return
                setDetail({
                  type: 'Account',
                  content: notification.account,
                })
              }}
            >
              {scrolling ? (
                <AvatarPlaceholder />
              ) : (
                <img
                  className="h-12 w-12 flex-none rounded-lg object-contain"
                  src={notification.account?.avatar ?? ''}
                  alt="avatar"
                  loading="lazy"
                />
              )}
              <div className="w-[calc(100%-56px)] pl-2">
                <p className="w-full truncate">
                  {notification.account?.display_name ?? ''}
                </p>
                <p className="w-full truncate text-gray-300">
                  @{notification.account?.acct ?? ''}
                </p>
              </div>
            </div>
            <div className="min-w-12">
              {notification.reaction?.static_url != null ? (
                <>
                  {scrolling ? (
                    <div className="h-12 w-12 flex-none rounded-lg" />
                  ) : (
                    <img
                      className="h-12 w-12 flex-none rounded-lg object-contain"
                      src={
                        notification.reaction?.static_url
                      }
                      title={notification.reaction?.name}
                      alt="emoji"
                      loading="lazy"
                    />
                  )}
                </>
              ) : (
                <span
                  className="text-3xl"
                  title={emoji.which(
                    notification.reaction?.name ?? ''
                  )}
                >
                  {notification.reaction?.name ?? ''}
                </span>
              )}
            </div>
          </h3>
          <Status
            status={notification.status as Entity.Status}
            scrolling={scrolling}
            small
          />
        </div>
      )
    case 'follow':
      return (
        <div className="ml-1 mt-2 box-border border-b-2 border-l-2 border-pink-300 pl-2">
          <p>Follow</p>
          <h3
            className="flex"
            onClick={() => {
              if (notification.account == null) return
              setDetail({
                type: 'Account',
                content: notification.account,
              })
            }}
          >
            {scrolling ? (
              <AvatarPlaceholder />
            ) : (
              <img
                className="h-12 w-12 flex-none rounded-lg object-contain"
                src={notification.account?.avatar ?? ''}
                alt="avatar"
                loading="lazy"
              />
            )}
            <div className="w-[calc(100%-56px)] pl-2">
              <p className="w-full truncate">
                {notification.account?.display_name ?? ''}
              </p>
              <p className="w-full truncate text-gray-300">
                @{notification.account?.acct ?? ''}
              </p>
            </div>
          </h3>
        </div>
      )
    case 'follow_request':
      return (
        <div className="ml-1 mt-2 box-border border-b-2 border-l-2 border-pink-500 pl-2">
          <p>Follow request</p>
          <h3
            className="flex"
            onClick={() => {
              if (notification.account == null) return
              setDetail({
                type: 'Account',
                content: notification.account,
              })
            }}
          >
            {scrolling ? (
              <AvatarPlaceholder />
            ) : (
              <img
                className="h-12 w-12 flex-none rounded-lg object-contain"
                src={notification.account?.avatar ?? ''}
                alt="avatar"
                loading="lazy"
              />
            )}
            <div className="w-[calc(100%-56px)] pl-2">
              <p className="w-full truncate">
                {notification.account?.display_name ?? ''}
              </p>
              <p className="w-full truncate text-gray-300">
                @{notification.account?.acct ?? ''}
              </p>
            </div>
          </h3>
        </div>
      )
    default:
      return null
  }
}
