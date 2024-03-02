/* eslint-disable @next/next/no-img-element */
import { Entity } from 'megalodon'

export const Card = ({
  card,
}: {
  card: Entity.Card | null
}) => {
  if (card == null) return null

  return (
    <a
      className="mx-2 flex flex-col items-center justify-center rounded-lg border border-gray-500"
      href={card.url}
      rel="noreferrer noopener"
      target="_blank"
    >
      {card.image != null && (
        <img
          className="aspect-video w-full rounded-t-lg object-cover"
          src={card.image}
          alt="card"
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
