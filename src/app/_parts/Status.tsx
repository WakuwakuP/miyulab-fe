import { Entity } from 'megalodon'
import { Media } from 'app/_parts/Media'
import { get } from 'http'

export const Status = ({
  status,
  className = '',
  small = false,
}: {
  status: Entity.Status
  className?: string
  small?: boolean
}) => {
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

  const getContentFormatted = (status: Entity.Status) => {
    let content = status.content
    if (status.emojis.length > 0) {
      status.emojis.forEach((emoji) => {
        content = content.replace(
          new RegExp(`:${emoji.shortcode}:`, 'gm'),
          `<img src="${emoji.url}" alt="${emoji.shortcode}" class="min-w-4 h-4 inline-block" />`
        )
      })
    }
    return content
  }

  return (
    <div
      className={[
        'w-full p-2 pb-6',
        className,
        small ? 'max-h-24 overflow-clip' : '',
      ].join(' ')}
    >
      {status.reblog ? (
        <>
          <div>
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
          <h3 className="flex">
            <img
              className={[
                'rounded-lg object-contain flex-none',
                small ? 'w-6 h-6' : 'w-12 h-12',
              ].join(' ')}
              src={status.reblog.account.avatar}
              alt="avatar"
            />
            <div className="pl-2 w-[calc(100%-56px)]">
              {small ? (
                <p className="w-full truncate text-ellipsis">
                  <span>
                    {getDisplayName(status.reblog.account)}
                  </span>
                  <span className="text-gray-300 pl-1">
                    @{status.reblog.account.acct}
                  </span>
                </p>
              ) : (
                <>
                  <p
                    className="w-full truncate text-ellipsis"
                    dangerouslySetInnerHTML={{
                      __html: getDisplayName(
                        status.reblog.account
                      ),
                    }}
                  />
                  <p className="text-gray-300 truncate text-ellipsis">
                    @{status.reblog.account.acct}
                  </p>
                </>
              )}
            </div>
          </h3>
        </>
      ) : (
        <h3 className="flex">
          <img
            className={[
              'rounded-lg object-contain flex-none',
              small ? 'w-6 h-6' : 'w-12 h-12',
            ].join(' ')}
            src={status.account.avatar}
            alt="avatar"
          />
          <div className="pl-2 w-[calc(100%-56px)]">
            {small ? (
              <p className="w-full truncate text-ellipsis">
                <span
                  dangerouslySetInnerHTML={{
                    __html: getDisplayName(status.account),
                  }}
                />
                <span className="text-gray-300 pl-1">
                  @{status.account.acct}
                </span>
              </p>
            ) : (
              <>
                <p
                  className="w-full truncate text-ellipsis"
                  dangerouslySetInnerHTML={{
                    __html: getDisplayName(status.account),
                  }}
                />
                <p className="text-gray-300 truncate text-ellipsis">
                  @{status.account.acct}
                </p>
              </>
            )}
          </div>
        </h3>
      )}
      <div
        className="content"
        dangerouslySetInnerHTML={{
          __html: getContentFormatted(status),
        }}
      />
      <div className="flex flex-wrap">
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
    </div>
  )
}
