'use client'

import { EmojiReactionPicker } from 'app/_parts/EmojiReactionPicker'
import type { Entity } from 'megalodon'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { FaLock } from 'react-icons/fa'
import {
  RiBookmark2Fill,
  RiBookmarkFill,
  RiEmotionLine,
  RiRepeatFill,
  RiReplyFill,
  RiStarFill,
  RiStarLine,
} from 'react-icons/ri'
import type { StatusAddAppIndex } from 'types/types'
import { REACTION_BACKENDS } from 'util/constants'
import { toggleReactionInDb } from 'util/db/sqlite/statusStore'
import { GetClient } from 'util/GetClient'
import { AppsContext } from 'util/provider/AppsProvider'
import { SetActionsContext } from 'util/provider/HomeTimelineProvider'
import { SetReplyToContext } from 'util/provider/ReplyToProvider'
import { SettingContext } from 'util/provider/SettingProvider'

export const Actions = ({
  status,
  onReactionsChange,
  onStatusChange,
}: {
  status: StatusAddAppIndex
  onReactionsChange?: (reactions: Entity.Reaction[]) => void
  onStatusChange?: (updates: Partial<Entity.Status>) => void
}) => {
  const apps = useContext(AppsContext)

  const setActions = useContext(SetActionsContext)

  const setReplyTo = useContext(SetReplyToContext)

  const setting = useContext(SettingContext)

  const [pendingAction, setPendingAction] = useState(false)
  const [reblogged, setReblogged] = useState(status.reblogged)

  const [favourited, setFavourited] = useState(status.favourited)
  const [bookmarked, setBookmarked] = useState(status.bookmarked)
  const [showReactionPicker, setShowReactionPicker] = useState(false)
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null)
  const pendingReaction = useRef(false)
  const reactionBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setReblogged(status.reblogged)
  }, [status.reblogged])

  useEffect(() => {
    setFavourited(status.favourited)
  }, [status.favourited])

  useEffect(() => {
    setBookmarked(status.bookmarked)
  }, [status.bookmarked])

  const handleReaction = useCallback(
    async (emoji: string) => {
      if (apps.length <= 0) return
      if (status.appIndex == null) return
      const reactionApp = apps[status.appIndex]
      if (
        reactionApp == null ||
        !REACTION_BACKENDS.includes(reactionApp.backend)
      )
        return
      const reactionClient = GetClient(reactionApp)
      const statusId = status.reblog?.id ?? status.id
      if (pendingReaction.current) return
      pendingReaction.current = true
      setPendingAction(true)
      setShowReactionPicker(false)
      try {
        const { data } = await reactionClient.createEmojiReaction(
          statusId,
          emoji,
        )
        await toggleReactionInDb(
          reactionApp.backendUrl,
          statusId,
          true,
          emoji,
        ).catch((error) =>
          console.error('Failed to cache the confirmed emoji reaction:', error),
        )
        onReactionsChange?.(data.emoji_reactions ?? [])
      } catch (error) {
        console.error('Failed to update emoji reaction:', error)
      } finally {
        pendingReaction.current = false
        setPendingAction(false)
      }
    },
    [apps, status.appIndex, status.reblog?.id, status.id, onReactionsChange],
  )

  const openPicker = useCallback(() => {
    if (reactionBtnRef.current) {
      setTriggerRect(reactionBtnRef.current.getBoundingClientRect())
    }
    setShowReactionPicker(true)
  }, [])

  const closePicker = useCallback(() => {
    setShowReactionPicker(false)
  }, [])

  const createdAt = new Date(status.created_at)
  const fullYear = createdAt.getFullYear()
  const month = (createdAt.getMonth() + 1).toString().padStart(2, '0')
  const date = createdAt.getDate().toString().padStart(2, '0')
  const hours = createdAt.getHours().toString().padStart(2, '0')

  const minutes = createdAt.getMinutes().toString().padStart(2, '0')

  const dateString = `${fullYear}/${month}/${date}`
  const timeString = `${hours}:${minutes}`

  if (apps.length <= 0) return null
  if (status.appIndex == null) return null

  const client = GetClient(apps[status.appIndex])

  const statusId = status.reblog?.id ?? status.id
  const applyAction = async (
    request: () => Promise<unknown>,
    update: () => void,
  ) => {
    if (pendingAction) return
    setPendingAction(true)
    try {
      await request()
      update()
    } catch (error) {
      console.error('Failed to update status action:', error)
    } finally {
      setPendingAction(false)
    }
  }

  const statusApp = apps[status.appIndex]
  const canReact =
    statusApp != null && REACTION_BACKENDS.includes(statusApp.backend)

  // Check if the status is private (either the status itself or the reblogged status)
  const statusVisibility = status.reblog?.visibility ?? status.visibility
  const isPrivate = statusVisibility === 'private'
  let reblogIcon = <RiRepeatFill size={24} />

  if (reblogged ?? false) {
    reblogIcon = <RiRepeatFill className="text-blue-400" size={24} />
  }

  if (isPrivate) {
    reblogIcon = <FaLock className="text-gray-400" size={24} />
  }

  return (
    <div className="flex justify-between pt-2 [&>button]:mx-1">
      <button
        className="flex items-center"
        onClick={() => {
          setReplyTo(status)
        }}
        type="button"
      >
        <RiReplyFill size={24} />

        <div className="pl-1">{status.replies_count}</div>
      </button>
      <button
        className={isPrivate ? 'cursor-not-allowed opacity-50' : ''}
        disabled={isPrivate || pendingAction}
        onClick={() =>
          applyAction(
            () =>
              reblogged
                ? client.unreblogStatus(statusId)
                : client.reblogStatus(statusId),
            () => {
              setActions.setReblogged(status.appIndex, statusId, !reblogged)
              setReblogged(!reblogged)
              onStatusChange?.({ reblogged: !reblogged })
            },
          )
        }
        type="button"
      >
        {reblogIcon}
      </button>
      <button
        disabled={pendingAction}
        onClick={() =>
          applyAction(
            () =>
              favourited
                ? client.unfavouriteStatus(statusId)
                : client.favouriteStatus(statusId),
            () => {
              setActions.setFavourited(status.appIndex, statusId, !favourited)
              setFavourited(!favourited)
              onStatusChange?.({ favourited: !favourited })
            },
          )
        }
        type="button"
      >
        {(favourited ?? false) ? (
          <RiStarFill className="text-orange-300" size={24} />
        ) : (
          <RiStarLine size={24} />
        )}
      </button>
      {canReact && (
        <>
          <button
            disabled={pendingAction}
            onClick={openPicker}
            ref={reactionBtnRef}
            type="button"
          >
            <RiEmotionLine size={24} />
          </button>
          {showReactionPicker && triggerRect && (
            <EmojiReactionPicker
              backendUrl={statusApp.backendUrl}
              onClose={closePicker}
              onSelect={handleReaction}
              reactions={setting.reactionEmojis}
              triggerRect={triggerRect}
            />
          )}
        </>
      )}
      <button
        disabled={pendingAction}
        onClick={() =>
          applyAction(
            () =>
              bookmarked
                ? client.unbookmarkStatus(statusId)
                : client.bookmarkStatus(statusId),
            () => {
              setActions.setBookmarked(status.appIndex, statusId, !bookmarked)
              setBookmarked(!bookmarked)
              onStatusChange?.({ bookmarked: !bookmarked })
            },
          )
        }
        type="button"
      >
        {bookmarked ? (
          <RiBookmark2Fill className="text-red-400" size={24} />
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
