/* eslint-disable @next/next/no-img-element */

import type { Entity } from 'megalodon'
import type { HTMLProps } from 'react'
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
        <div
          className="aspect-square max-h-48 cursor-pointer p-0.5"
          onClick={() => {
            if (onClick != null) onClick()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              if (onClick != null) onClick()
            }
          }}
          role="button"
          tabIndex={0}
        >
          <img
            alt=""
            className={['object-contain', className].join(' ')}
            key={media.id}
            src={media.preview_url ?? media.url}
          />
        </div>
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
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              if (onClick != null) onClick()
            }
          }}
          role="button"
          tabIndex={0}
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
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              if (onClick != null) onClick()
            }
          }}
          role="button"
          tabIndex={0}
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
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              if (onClick != null) onClick()
            }
          }}
          role="button"
          tabIndex={0}
        >
          <audio className="w-full" controls key={media.id} src={media.url} />
          <div
            className="absolute left-0 top-0 z-1 h-full w-full"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (onClick != null) onClick()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                if (onClick != null) onClick()
              }
            }}
            role="button"
            tabIndex={0}
          />
        </div>
      )
    default:
      return null
  }
}
