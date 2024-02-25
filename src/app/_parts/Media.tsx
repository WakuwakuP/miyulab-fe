import { HTMLProps } from 'react'

import { Entity } from 'megalodon'

export const Media = ({
  media,
  className = 'w-full',
}: {
  media: Entity.Attachment
  className?: HTMLProps<HTMLElement>['className']
}) => {
  switch (media.type) {
    case 'image':
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={media.id}
          src={media.url}
          alt=""
          className={[
            'p-0.5 object-contain max-h-48 border-1',
            className,
          ].join(' ')}
        />
      )
    case 'video':
      return (
        <video
          key={media.id}
          src={media.url}
          controls
          muted
          className={[
            'p-0.5 object-contain',
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
            'p-0.5 object-contain',
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
            'p-0.5 object-contain',
            className,
          ].join(' ')}
        />
      )
    case 'unknown':
    default:
      return null
  }
}
