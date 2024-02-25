import { Entity } from 'megalodon'
import { Media } from 'app/_parts/Media'

export const Status = ({
  status,
}: {
  status: Entity.Status
}) => {
  return (
    <div className="w-full">
      <h3 className="flex">
        <img
          className="w-12 h-12 rounded-lg object-contain flex-none"
          src={status.account.avatar}
          alt="avatar"
        />
        <div className="pl-2 w-[calc(100%-56px)]">
          <p className="w-full truncate text-ellipsis">
            {status.account.display_name}
          </p>
          <p className="text-gray-300 truncate text-ellipsis">
            @{status.account.acct}
          </p>
        </div>
      </h3>
      <div
        className="[&_*]:text-wrap [&_*]:whitespace-pre-line [&_*]:break-words [&_a]:text-blue-400"
        dangerouslySetInnerHTML={{
          __html: `${status.content}`,
        }}
      />
      <div className="flex flex-wrap">
        {status.media_attachments.map(
          (media: Entity.Attachment) => {
            switch (status.media_attachments.length) {
              case 1:
                return <Media media={media} />
              case 2:
                return (
                  <Media
                    media={media}
                    className="w-1/2"
                  />
                )
              default:
                return (
                  <Media
                    media={media}
                    className="w-1/3"
                  />
                )
            }
          }
        )}
      </div>
    </div>
  )
}
