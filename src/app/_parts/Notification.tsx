import { Entity } from 'megalodon'
import { Status } from 'app/_parts/Status'

export const Notification = ({
  notification,
}: {
  notification: Entity.Notification
}) => {
  switch (notification.type) {
    case 'mention':
      return (
        <div className="box-border border-l-4 border-b-4 border-green-500 pl-2 mt-2 ml-1">
          <Status
            status={notification.status as Entity.Status}
            small
          />
        </div>
      )
    case 'reblog':
      return (
        <div className="box-border border-l-4 border-b-4 border-blue-500 pl-2 mt-2 ml-1">
          <h3 className="flex">
            <img
              className="w-12 h-12 rounded-lg object-contain flex-none"
              src={notification.account?.avatar || ''}
              alt="avatar"
            />
            <div className="pl-2 w-[calc(100%-56px)]">
              <p className="w-full truncate text-ellipsis">
                {notification.account?.display_name || ''}
              </p>
              <p className="w-full text-gray-300 truncate text-ellipsis">
                @{notification.account?.acct || ''}
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
        <div className="box-border border-l-4 border-b-4 border-orange-300 pl-2 mt-2 ml-1">
          <h3 className="flex">
            <img
              className="w-12 h-12 rounded-lg object-contain flex-none"
              src={notification.account?.avatar || ''}
              alt="avatar"
            />
            <div className="pl-2 w-[calc(100%-56px)]">
              <p className="w-full truncate text-ellipsis">
                {notification.account?.display_name || ''}
              </p>
              <p className="w-full text-gray-300 truncate text-ellipsis">
                @{notification.account?.acct || ''}
              </p>
            </div>
          </h3>
          <Status
            status={notification.status as Entity.Status}
            small
          />
        </div>
      )
    case 'reaction':
      return (
        <div className="box-border border-l-4 border-b-4 border-orange-300 pl-2 mt-2 ml-1">
          <h3>
            <div className="flex">
              <img
                className="w-12 h-12 rounded-lg object-contain flex-none"
                src={notification.account?.avatar || ''}
                alt="avatar"
              />
              <div className="pl-2 w-[calc(100%-56px)]  flex-shrink-1">
                <p className="w-full truncate text-ellipsis">
                  {notification.account?.display_name || ''}
                </p>
                <p className="w-full text-gray-300 truncate text-ellipsis">
                  @{notification.account?.acct || ''}
                </p>
              </div>
            </div>
            <div className="min-w-12">
              {notification.reaction?.static_url ? (
                <img
                  className="w-12 h-12 rounded-lg object-contain flex-none"
                  src={
                    notification.reaction?.static_url || ''
                  }
                  alt="emoji"
                />
              ) : (
                <span className="text-3xl">
                  {notification.reaction?.name}
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
        <div className="box-border border-l-4 border-b-4 border-l-pink-300 pl-2 mt-2 ml-1">
          <p>Follow</p>
          <h3 className="flex">
            <img
              className="w-12 h-12 rounded-lg object-contain flex-none"
              src={notification.account?.avatar || ''}
              alt="avatar"
            />
            <div className="pl-2 w-[calc(100%-56px)]">
              <p className="w-full truncate text-ellipsis">
                {notification.account?.display_name || ''}
              </p>
              <p className="w-full text-gray-300 truncate text-ellipsis">
                @{notification.account?.acct || ''}
              </p>
            </div>
          </h3>
        </div>
      )
    case 'follow_request':
      return (
        <div className="box-border border-l-4 border-b-4 border-l-pink-500 pl-2 mt-2 ml-1">
          <p>Follow request</p>
          <h3 className="flex">
            <img
              className="w-12 h-12 rounded-lg object-contain flex-none"
              src={notification.account?.avatar || ''}
              alt="avatar"
            />
            <div className="pl-2 w-[calc(100%-56px)]">
              <p className="w-full truncate text-ellipsis">
                {notification.account?.display_name || ''}
              </p>
              <p className="w-full text-gray-300 truncate text-ellipsis">
                @{notification.account?.acct || ''}
              </p>
            </div>
          </h3>
        </div>
      )
    default:
      return null
  }
}
