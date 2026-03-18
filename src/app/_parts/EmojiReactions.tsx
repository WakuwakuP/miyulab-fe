/* eslint-disable @next/next/no-img-element */
'use client'

import type { Entity } from 'megalodon'
import { useContext } from 'react'
import type { StatusAddAppIndex } from 'types/types'
import { REACTION_BACKENDS } from 'util/constants'
import { toggleReactionInDb } from 'util/db/sqlite/statusStore'
import { GetClient } from 'util/GetClient'
import { AppsContext } from 'util/provider/AppsProvider'
import { SelectedAppIndexContext } from 'util/provider/PostAccountProvider'

export const EmojiReactions = ({
  status,
  reactions,
  onToggle,
}: {
  status: StatusAddAppIndex
  reactions: Entity.Reaction[]
  onToggle: (reactionName: string, currentlyMine: boolean) => void
}) => {
  const apps = useContext(AppsContext)
  const selectedAppIndex = useContext(SelectedAppIndexContext)

  if (reactions.length === 0) return null

  const selectedApp = apps[selectedAppIndex]
  const canReact =
    selectedApp != null && REACTION_BACKENDS.includes(selectedApp.backend)

  const handleReactionClick = (reaction: Entity.Reaction) => {
    if (!canReact || selectedApp == null) return

    const client = GetClient(selectedApp)
    const statusId = status.reblog?.id ?? status.id

    onToggle(reaction.name, reaction.me)

    if (reaction.me) {
      client.deleteEmojiReaction(statusId, reaction.name).catch((error) => {
        console.error('Failed to remove reaction:', error)
      })
      // DB からリアクションを削除
      toggleReactionInDb(selectedApp.backendUrl, statusId, false, reaction.name)
    } else {
      client.createEmojiReaction(statusId, reaction.name).catch((error) => {
        console.error('Failed to add reaction:', error)
      })
      // DB にリアクションを保存
      toggleReactionInDb(selectedApp.backendUrl, statusId, true, reaction.name)
    }
  }

  return (
    <div className="flex flex-wrap gap-1 pt-1">
      {reactions.map((reaction) => (
        <button
          className={[
            'flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm',
            reaction.me
              ? 'border-blue-400 bg-blue-400/20'
              : 'border-gray-600 hover:bg-gray-700',
            canReact ? 'cursor-pointer' : 'cursor-default',
          ].join(' ')}
          disabled={!canReact}
          key={reaction.name}
          onClick={() => handleReactionClick(reaction)}
          type="button"
        >
          {reaction.static_url || reaction.url ? (
            <img
              alt={reaction.name}
              className="h-5 w-5 object-contain"
              loading="lazy"
              src={reaction.static_url ?? reaction.url ?? ''}
              title={reaction.name}
            />
          ) : (
            <span>{reaction.name}</span>
          )}
          <span className="text-xs text-gray-300">{reaction.count}</span>
        </button>
      ))}
    </div>
  )
}
