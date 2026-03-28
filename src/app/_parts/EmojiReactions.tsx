/* eslint-disable @next/next/no-img-element */
'use client'

import type { Entity } from 'megalodon'
import { useContext, useMemo } from 'react'
import type { StatusAddAppIndex } from 'types/types'
import { REACTION_BACKENDS } from 'util/constants'
import { toggleReactionInDb } from 'util/db/sqlite/statusStore'
import { GetClient } from 'util/GetClient'
import { AppsContext } from 'util/provider/AppsProvider'
import {
  EmojiCatalogContext,
  EmojiContext,
} from 'util/provider/ResourceProvider'

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
  const emojiCatalog = useContext(EmojiCatalogContext)
  const emojiFallback = useContext(EmojiContext)

  // サーバー絵文字カタログから shortcode → url のマップを構築
  const emojiUrlMap = useMemo(() => {
    const map = new Map<string, { url: string; static_url?: string }>()
    const statusApp =
      status.appIndex != null ? apps[status.appIndex] : undefined
    if (statusApp?.backendUrl) {
      const catalog = emojiCatalog.get(statusApp.backendUrl)
      const list = catalog && catalog.length > 0 ? catalog : emojiFallback
      for (const e of list) {
        map.set(e.shortcode, { static_url: e.static_url, url: e.url })
      }
    }
    return map
  }, [status.appIndex, apps, emojiCatalog, emojiFallback])

  if (reactions.length === 0) return null

  const statusApp = status.appIndex != null ? apps[status.appIndex] : undefined
  const canReact =
    statusApp != null && REACTION_BACKENDS.includes(statusApp.backend)

  const handleReactionClick = (reaction: Entity.Reaction) => {
    if (!canReact || statusApp == null) return

    const client = GetClient(statusApp)
    const statusId = status.reblog?.id ?? status.id

    onToggle(reaction.name, reaction.me)

    if (reaction.me) {
      client.deleteEmojiReaction(statusId, reaction.name).catch((error) => {
        console.error('Failed to remove reaction:', error)
      })
      // DB からリアクションを削除
      toggleReactionInDb(statusApp.backendUrl, statusId, false, reaction.name)
    } else {
      client.createEmojiReaction(statusId, reaction.name).catch((error) => {
        console.error('Failed to add reaction:', error)
      })
      // DB にリアクションを保存
      toggleReactionInDb(statusApp.backendUrl, statusId, true, reaction.name)
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
          {(() => {
            let imgUrl = reaction.static_url ?? reaction.url
            // URL が無いカスタム絵文字はサーバー絵文字カタログからフォールバック
            if (
              !imgUrl &&
              reaction.name.startsWith(':') &&
              reaction.name.endsWith(':')
            ) {
              const shortcode = reaction.name.slice(1, -1)
              const found = emojiUrlMap.get(shortcode)
              if (found) {
                imgUrl = found.static_url ?? found.url
              }
            }
            return imgUrl ? (
              <img
                alt={reaction.name}
                className="h-5 w-5 object-contain"
                loading="lazy"
                src={imgUrl}
                title={reaction.name}
              />
            ) : (
              <span>{reaction.name}</span>
            )
          })()}
          <span className="text-xs text-gray-300">{reaction.count}</span>
        </button>
      ))}
    </div>
  )
}
