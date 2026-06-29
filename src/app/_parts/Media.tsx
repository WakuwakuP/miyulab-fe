import type { Entity } from 'megalodon'
import type { HTMLProps } from 'react'
import { RiPlayCircleLine } from 'react-icons/ri'
import { toSecureResourceUrl } from 'util/secureResourceUrl'

export const Media = ({
  media,
  onClick,
  scrolling = false,
  className = 'w-full',
  fullSize = false,
}: {
  media: Entity.Attachment
  onClick?: () => void
  scrolling?: boolean
  className?: HTMLProps<HTMLElement>['className']
  fullSize?: boolean
}) => {
  const mediaUrl = toSecureResourceUrl(media.url) ?? ''
  const previewUrl = toSecureResourceUrl(media.preview_url)
  const remoteUrl = toSecureResourceUrl(media.remote_url)

  if (scrolling)
    return (
      <div
        className={[
          'aspect-square max-h-48 cursor-pointer object-contain p-0.5',
          className,
        ].join(' ')}
      />
    )
  switch (media.type) {
    case 'image':
      return (
        <img
          alt=""
          className={[
            'aspect-square max-h-48 cursor-pointer object-contain p-0.5',
            className,
          ].join(' ')}
          height={1920}
          key={media.id}
          onClick={() => {
            if (onClick != null) onClick()
          }}
          src={fullSize ? (remoteUrl ?? mediaUrl) : (previewUrl ?? mediaUrl)}
          width={1920}
        />
      )
    case 'video':
      return (
        <div
          className={[
            'relative aspect-square max-h-48 object-contain p-0.5',
            className,
          ].join(' ')}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (onClick != null) onClick()
          }}
        >
          <video
            className="h-full w-full object-contain"
            key={media.id}
            muted
            src={mediaUrl}
          />
          <div className="absolute left-0 top-0 h-full w-full bg-black/50">
            <RiPlayCircleLine
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white"
              size={70}
            />
          </div>
        </div>
      )
    case 'gifv':
      return (
        <div
          className={[
            'relative aspect-square max-h-48 object-contain p-0.5',
            className,
          ].join(' ')}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (onClick != null) onClick()
          }}
        >
          <video
            className="h-full w-full object-contain"
            key={media.id}
            muted
            src={mediaUrl}
          />
          <div className="absolute left-0 top-0 h-full w-full bg-black/50">
            <RiPlayCircleLine
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white"
              size={70}
            />
          </div>
        </div>
      )
    case 'audio':
      return (
        <div
          className={['relative h-16 p-0.5', className].join(' ')}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (onClick != null) onClick()
          }}
        >
          <audio className="w-full" controls key={media.id} src={mediaUrl} />
          <button
            className="absolute left-0 top-0 z-1 h-full w-full border-0 bg-transparent p-0"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (onClick != null) onClick()
            }}
            type="button"
          />
        </div>
      )
    case 'unknown':
      return null
    default:
      return null
  }
}
