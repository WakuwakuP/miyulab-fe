/* eslint-disable @next/next/no-img-element */
import { HTMLProps } from 'react'

import { Entity } from 'megalodon'

export const Media = ({
  media,
  onClick,
  className = 'w-full',
}: {
  media: Entity.Attachment
  onClick?: () => void
  className?: HTMLProps<HTMLElement>['className']
}) => {
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
              'p-0.5 object-contain h-48 border-1 bg-black cursor-pointer',
              className,
            ].join(' ')}
            loading="lazy"
          />
        </>
      )
    case 'video':
      return (
        <video
          key={media.id}
          src={media.url}
          controls
          muted
          className={[
            'h-48 p-0.5 object-contain',
            className,
          ].join(' ')}
        />
      )
    case 'gifv':
      return (
        <video
          key={media.id}
          src={media.url}
          controls
          className={[
            'h-48 p-0.5 object-contain',
            className,
          ].join(' ')}
        />
      )
    case 'audio':
      return (
        <audio
          key={media.id}
          src={media.url}
          controls
          className={[
            'h-20 p-0.5 object-contain',
            className,
          ].join(' ')}
        />
      )
    case 'unknown':
    default:
      return null
  }
}
