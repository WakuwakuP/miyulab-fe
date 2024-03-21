/* eslint-disable @next/next/no-img-element */
import { MouseEventHandler, useContext } from 'react'

import { Entity } from 'megalodon'
import ReactPlayer from 'react-player'

import { SetPlayerContext } from 'util/provider/PlayerProvider'

export const Card = ({
  card,
}: {
  card: Entity.Card | null
}) => {
  const setPlayer = useContext(SetPlayerContext)

  if (card == null) return null

  const onClick: MouseEventHandler<HTMLAnchorElement> = (
    e
  ) => {
    if (ReactPlayer.canPlay(card.url)) {
      e.preventDefault()
      e.stopPropagation()
      setPlayer({
        attachment: [
          {
            id: '',
            url: card.url,
            type: 'video',
            blurhash: null,
            remote_url: null,
            preview_url: null,
            text_url: null,
            meta: null,
            description: '',
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
        <img
          className="aspect-video w-full rounded-t-lg object-cover"
          src={card.image}
          alt="card"
          loading="lazy"
        />
      )}
      <div className="w-full px-2">
        <div className="w-full truncate text-lg">
          {card.title}
        </div>
        <div className="line-clamp-3 w-full text-gray-400">
          {card.description}
        </div>
        <div className="line-clamp-3 w-full text-gray-600">
          {card.url}
        </div>
      </div>
    </a>
  )
}
