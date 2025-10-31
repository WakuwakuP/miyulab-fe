import type { Entity } from 'megalodon'
import type { HTMLProps } from 'react'
import { RiPlayCircleLine } from 'react-icons/ri'
import { ProxyImage } from './ProxyImage'

export const Media = ({
  media,
  onClick,
  scrolling = false,
  className = 'w-full',
}: {
  media: Entity.Attachment
  onClick?: () => void
  scrolling?: boolean
  className?: HTMLProps<HTMLElement>['className']
}) => {
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
        <ProxyImage
          alt=""
          className={[
            'aspect-square max-h-48 cursor-pointer object-contain p-0.5',
            className,
          ].join(' ')}
          height={800}
          key={media.id}
          onClick={() => {
            if (onClick != null) onClick()
          }}
          src={media.preview_url ?? media.url}
          width={800}
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
            src={media.url}
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
            src={media.url}
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
          <audio className="w-full" controls key={media.id} src={media.url} />
          <div
            className="absolute left-0 top-0 z-1 h-full w-full"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (onClick != null) onClick()
            }}
          />
        </div>
      )
    case 'unknown':
      return null
    default:
      return null
  }
}
