/* eslint-disable @next/next/no-img-element */
import { HTMLProps, useState } from 'react'

import { Entity } from 'megalodon'
import { createPortal } from 'react-dom'

export const Media = ({
  media,
  className = 'w-full',
}: {
  media: Entity.Attachment
  className?: HTMLProps<HTMLElement>['className']
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false)

  switch (media.type) {
    case 'image':
      return (
        <>
          <img
            onClick={() => {
              setIsModalOpen(true)
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
          {isModalOpen &&
            createPortal(
              <div
                className="fixed inset-0 z-40 h-screen w-screen bg-black/60"
                onClick={() => {
                  setIsModalOpen(false)
                }}
              >
                <img
                  src={media.url}
                  alt=""
                  className="fixed inset-0 z-50 m-auto h-[90vh] w-[90vw] object-contain"
                  loading="lazy"
                />
              </div>,
              document.body
            )}
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
