/* eslint-disable @next/next/no-img-element */

import { ProxyImage } from 'app/_parts/ProxyImage'
import type { Entity } from 'megalodon'
import { type MouseEventHandler, useContext } from 'react'

import { canPlay } from 'util/PlayerUtils'
import { SetPlayerContext } from 'util/provider/PlayerProvider'

export const Card = ({ card }: { card: Entity.Card | null }) => {
  const setPlayer = useContext(SetPlayerContext)

  if (card == null) return null

  const onClick: MouseEventHandler<HTMLAnchorElement> = (e) => {
    if (canPlay(card.url)) {
      e.preventDefault()
      e.stopPropagation()
      setPlayer({
        attachment: [
          {
            blurhash: null,
            description: '',
            id: '',
            meta: null,
            preview_url: null,
            remote_url: null,
            text_url: null,
            type: 'video',
            url: card.url,
          },
        ],
        index: 0,
      })
    }
  }

  return (
    <a
      className="mx-2 flex flex-col items-center justify-center rounded-lg border border-gray-500"
      href={card.url}
      onClick={onClick}
      rel="noreferrer noopener"
      target="_blank"
    >
      {card.image != null && (
        <ProxyImage
          alt="card"
          className="aspect-video w-full rounded-t-lg object-cover"
          height={720}
          src={card.image}
          width={1280}
        />
      )}
      <div className="w-full px-2">
        <div className="w-full truncate text-lg">{card.title}</div>
        <div className="line-clamp-3 w-full text-gray-400">
          {card.description}
        </div>
        <div className="line-clamp-3 w-full text-gray-600">{card.url}</div>
      </div>
    </a>
  )
}
