'use client'

import { useContext, useEffect, useState } from 'react'

import {
  RiBookmark2Fill,
  RiBookmarkFill,
  RiEmotionHappyLine,
  RiRepeatFill,
  RiReplyFill,
  RiStarFill,
  RiStarLine,
} from 'react-icons/ri'

import { type StatusAddAppIndex } from 'types/types'
import { GetClient } from 'util/GetClient'
import { AppsContext } from 'util/provider/AppsProvider'
import { SetActionsContext } from 'util/provider/HomeTimelineProvider'
import { SetReplyToContext } from 'util/provider/ReplyToProvider'

// Simple emoji picker component
const EmojiPicker = ({
  onEmojiSelect,
  onClose,
}: {
  onEmojiSelect: (emoji: string) => void
  onClose: () => void
}) => {
  const commonEmojis = [
    '👍',
    '❤️',
    '😄',
    '😢',
    '😮',
    '😠',
    '👏',
    '🔥',
  ]

  return (
    <div className="absolute bottom-8 left-0 z-10 flex gap-1 rounded bg-white p-2 shadow-lg border border-gray-300">
      {commonEmojis.map((emoji) => (
        <button
          key={emoji}
          onClick={() => onEmojiSelect(emoji)}
          className="hover:bg-gray-100 p-1 rounded text-lg"
          title={emoji}
        >
          {emoji}
        </button>
      ))}
      <button
        onClick={onClose}
        className="hover:bg-gray-100 p-1 rounded text-sm text-gray-600"
        title="Close"
      >
        ✕
      </button>
    </div>
  )
}

export const Actions = ({
  status,
}: {
  status: StatusAddAppIndex
}) => {
  const apps = useContext(AppsContext)

  const setActions = useContext(SetActionsContext)

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

  const [showEmojiPicker, setShowEmojiPicker] =
    useState(false)

  useEffect(() => {}, [])

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

  if (apps.length <= 0) return null
  if (status.appIndex == null) return null

  const client = GetClient(apps[status.appIndex])

  const handleEmojiReaction = async (emoji: string) => {
    try {
      const targetStatus = status.reblog ?? status
      const existingReaction =
        targetStatus.emoji_reactions?.find(
          (reaction) =>
            reaction.name === emoji && reaction.me
        )

      if (existingReaction != null) {
        // Remove reaction if it already exists
        const response = await client.deleteEmojiReaction(
          targetStatus.id,
          emoji
        )
        setActions.updateReactions(
          status.appIndex,
          targetStatus.id,
          response.data.emoji_reactions ?? []
        )
      } else {
        // Add reaction if it doesn't exist
        const response = await client.createEmojiReaction(
          targetStatus.id,
          emoji
        )
        setActions.updateReactions(
          status.appIndex,
          targetStatus.id,
          response.data.emoji_reactions ?? []
        )
      }
    } catch (error) {
      console.error(
        'Failed to toggle emoji reaction:',
        error
      )
    }
    setShowEmojiPicker(false)
  }

  return (
    <div className="pt-2">
      {/* Reactions display */}
      {(status.reblog ?? status).emoji_reactions != null &&
        (status.reblog ?? status).emoji_reactions.length >
          0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {(status.reblog ?? status).emoji_reactions.map(
              (reaction, index) => (
                <button
                  key={`${reaction.name}-${index}`}
                  onClick={() =>
                    handleEmojiReaction(reaction.name)
                  }
                  className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs border ${
                    reaction.me === true
                      ? 'bg-blue-100 border-blue-300 text-blue-800'
                      : 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200'
                  }`}
                  title={`${reaction.name} (${reaction.count})`}
                >
                  {reaction.static_url != null &&
                  reaction.static_url !== '' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={reaction.static_url}
                      alt={reaction.name}
                      className="w-4 h-4"
                    />
                  ) : (
                    <span>{reaction.name}</span>
                  )}
                  <span>{reaction.count}</span>
                </button>
              )
            )}
          </div>
        )}

      {/* Action buttons */}
      <div className="flex justify-between [&>button]:mx-1 [&>div]:mx-1 relative">
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
              client.unreblogStatus(
                status.reblog?.id ?? status.id
              )
              setActions.setReblogged(
                status.appIndex,
                status.reblog?.id ?? status.id,
                false
              )
              setReblogged(false)
            } else {
              client.reblogStatus(
                status.reblog?.id ?? status.id
              )
              setActions.setReblogged(
                status.appIndex,
                status.reblog?.id ?? status.id,
                true
              )
              setReblogged(true)
            }
          }}
        >
          {(reblogged ?? false) ? (
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
              setActions.setFavourited(
                status.appIndex,
                status.reblog?.id ?? status.id,
                false
              )
              setFavourited(false)
            } else {
              client.favouriteStatus(
                status.reblog?.id ?? status.id
              )
              setActions.setFavourited(
                status.appIndex,
                status.reblog?.id ?? status.id,
                true
              )
              setFavourited(true)
            }
          }}
        >
          {(favourited ?? false) ? (
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
              setActions.setBookmarked(
                status.appIndex,
                status.reblog?.id ?? status.id,
                false
              )
              setBookmarked(false)
            } else {
              client.bookmarkStatus(
                status.reblog?.id ?? status.id
              )
              setActions.setBookmarked(
                status.appIndex,
                status.reblog?.id ?? status.id,
                true
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

        {/* Emoji reaction button */}
        <div className="relative">
          <button
            onClick={() =>
              setShowEmojiPicker(!showEmojiPicker)
            }
            className="flex items-center"
            title="Add reaction"
          >
            <RiEmotionHappyLine size={24} />
          </button>

          {showEmojiPicker && (
            <EmojiPicker
              onEmojiSelect={handleEmojiReaction}
              onClose={() => setShowEmojiPicker(false)}
            />
          )}
        </div>

        <div className=" text-right text-xs">
          <p>{dateString}</p>
          <p>{timeString}</p>
        </div>
      </div>
    </div>
  )
}
