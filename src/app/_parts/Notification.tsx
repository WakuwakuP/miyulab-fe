/* eslint-disable @next/next/no-img-element */
import { Entity } from 'megalodon'
import { RiStarFill } from 'react-icons/ri'

import { Status } from 'app/_parts/Status'

export const Notification = ({
  notification,
}: {
  notification: Entity.Notification
}) => {
  switch (notification.type) {
    case 'mention':
      return (
        <div className="ml-1 mt-2 box-border border-b-4 border-l-4 border-green-500 pl-2">
          <Status
            status={notification.status as Entity.Status}
            small
          />
        </div>
      )
    case 'reblog':
      return (
        <div className="ml-1 mt-2 box-border border-b-4 border-l-4 border-blue-500 pl-2">
          <h3 className="flex">
            <img
              className="h-12 w-12 flex-none rounded-lg object-contain"
              src={notification.account?.avatar ?? ''}
              alt="avatar"
            />
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
            small
          />
        </div>
      )
    case 'favourite':
      return (
        <div className="ml-1 mt-2 box-border border-b-4 border-l-4 border-orange-300 pl-2">
          <h3 className="flex">
            <img
              className="h-12 w-12 flex-none rounded-lg object-contain"
              src={notification.account?.avatar ?? ''}
              alt="avatar"
            />
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
            small
          />
        </div>
      )
    case 'reaction':
      return (
        <div className="ml-1 mt-2 box-border border-b-4 border-l-4 border-orange-300 pl-2">
          <h3>
            <div className="flex">
              <img
                className="h-12 w-12 flex-none rounded-lg object-contain"
                src={notification.account?.avatar ?? ''}
                alt="avatar"
              />
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
                <img
                  className="h-12 w-12 flex-none rounded-lg object-contain"
                  src={notification.reaction?.static_url}
                  alt="emoji"
                />
              ) : (
                <span className="text-3xl">
                  {notification.reaction?.name ?? ''}
                </span>
              )}
            </div>
          </h3>
          <Status
            status={notification.status as Entity.Status}
            small
          />
        </div>
      )
    case 'follow':
      return (
        <div className="ml-1 mt-2 box-border border-b-4 border-l-4 border-l-pink-300 pl-2">
          <p>Follow</p>
          <h3 className="flex">
            <img
              className="h-12 w-12 flex-none rounded-lg object-contain"
              src={notification.account?.avatar ?? ''}
              alt="avatar"
            />
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
        <div className="ml-1 mt-2 box-border border-b-4 border-l-4 border-l-pink-500 pl-2">
          <p>Follow request</p>
          <h3 className="flex">
            <img
              className="h-12 w-12 flex-none rounded-lg object-contain"
              src={notification.account?.avatar ?? ''}
              alt="avatar"
            />
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
