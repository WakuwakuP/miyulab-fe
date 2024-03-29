'use client'

import { useContext, useState } from 'react'

import { Entity } from 'megalodon'
import {
  RiBookmark2Fill,
  RiBookmarkFill,
  RiRepeatFill,
  RiReplyFill,
  RiStarFill,
  RiStarLine,
} from 'react-icons/ri'

import { GetClient } from 'util/GetClient'
import { TokenContext } from 'util/provider/AppProvider'
import { SetReplyToContext } from 'util/provider/ReplyToProvider'

export const Actions = ({
  status,
}: {
  status: Entity.Status
}) => {
  const token = useContext(TokenContext)

  const setReplyTo = useContext(SetReplyToContext)

  const [reblogged, setReblogged] = useState(
    status.reblogged
  )
  const [favourited, setFavourited] = useState(
    status.favourited
  )
  const [bookmarked, setBookmarked] = useState(
    status.bookmarked
  )

  const createdAt = new Date(status.created_at)
  const fullYear = createdAt.getFullYear()
  const month = (createdAt.getMonth() + 1)
    .toString()
    .padStart(2, '0')
  const date = createdAt
    .getDate()
    .toString()
    .padStart(2, '0')
  const hours = createdAt
    .getHours()
    .toString()
    .padStart(2, '0')

  const minutes = createdAt
    .getMinutes()
    .toString()
    .padStart(2, '0')

  const dateString = `${fullYear}/${month}/${date}`
  const timeString = `${hours}:${minutes}`

  if (token === null) {
    return null
  }

  const client = GetClient(token.access_token)

  return (
    <div className="flex justify-between pt-2 [&>button]:mx-1">
      <button
        className="flex items-center"
        onClick={() => {
          setReplyTo(status)
        }}
      >
        <RiReplyFill size={24} />

        <div className="pl-1">{status.replies_count}</div>
      </button>
      <button
        onClick={() => {
          if (reblogged ?? false) {
            client.unreblogStatus(status.id)
            setReblogged(false)
          } else {
            client.reblogStatus(status.id)
            setReblogged(true)
          }
        }}
      >
        {reblogged ?? false ? (
          <RiRepeatFill
            size={24}
            className="text-blue-400"
          />
        ) : (
          <RiRepeatFill size={24} />
        )}
      </button>
      <button
        onClick={() => {
          if (favourited ?? false) {
            client.unfavouriteStatus(
              status.reblog?.id ?? status.id
            )
            setFavourited(false)
          } else {
            client.favouriteStatus(
              status.reblog?.id ?? status.id
            )
            setFavourited(true)
          }
        }}
      >
        {favourited ?? false ? (
          <RiStarFill
            size={24}
            className="text-orange-300"
          />
        ) : (
          <RiStarLine size={24} />
        )}
      </button>
      <button
        onClick={() => {
          if (bookmarked ?? false) {
            client.unbookmarkStatus(
              status.reblog?.id ?? status.id
            )
            setBookmarked(false)
          } else {
            client.bookmarkStatus(
              status.reblog?.id ?? status.id
            )
            setBookmarked(true)
          }
        }}
      >
        {bookmarked ? (
          <RiBookmark2Fill
            size={24}
            className="text-red-400"
          />
        ) : (
          <RiBookmarkFill size={24} />
        )}
      </button>
      <div className=" text-right text-xs">
        <p>{dateString}</p>
        <p>{timeString}</p>
      </div>
    </div>
  )
}
