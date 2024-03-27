/* eslint-disable @next/next/no-img-element */
import { HTMLProps } from 'react'

import { Entity } from 'megalodon'
import { RiPlayCircleLine } from 'react-icons/ri'

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
        <>
          <img
            onClick={() => {
              if (onClick != null) onClick()
            }}
            key={media.id}
            src={media.preview_url ?? media.url}
            alt=""
            className={[
              'aspect-square max-h-48 cursor-pointer object-contain p-0.5',
              className,
            ].join(' ')}
          />
        </>
      )
    case 'video':
      return (
        <div
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (onClick != null) onClick()
          }}
          className={[
            'relative aspect-square max-h-48 object-contain p-0.5',
            className,
          ].join(' ')}
        >
          <video
            key={media.id}
            src={media.url}
            muted
            className="h-full w-full object-contain"
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
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (onClick != null) onClick()
          }}
          className={[
            'relative aspect-square max-h-48 object-contain p-0.5',
            className,
          ].join(' ')}
        >
          <video
            key={media.id}
            src={media.url}
            muted
            className="h-full w-full object-contain"
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
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (onClick != null) onClick()
          }}
          className={[
            'relative h-16 p-0.5',
            className,
          ].join(' ')}
        >
          <audio
            key={media.id}
            src={media.url}
            controls
            className="w-full"
          />
          <div
            className="absolute left-0 top-0 z-[1] h-full w-full"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (onClick != null) onClick()
            }}
          />
        </div>
      )
    case 'unknown':
    default:
      return null
  }
}
