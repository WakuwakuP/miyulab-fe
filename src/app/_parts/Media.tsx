import { Entity } from 'megalodon'
import { HTMLProps } from 'react'

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
        <img
          key={media.id}
          src={media.preview_url || undefined}
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
          src={media.url || undefined}
          controls
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
          src={media.url || undefined}
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
          src={media.url || undefined}
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
