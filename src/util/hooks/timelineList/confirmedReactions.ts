import type { Entity } from 'megalodon'
import type { TimelineItem } from 'types/timelineViewModel'
import type { App } from 'types/types'
import { toggleReactionInDb } from 'util/db/sqlite/statusStore'
import { GetClient } from 'util/GetClient'

type ReactionChange = { reactions: Entity.Reaction[] }
const pendingWrites = new Map<string, ReactionChange>()
const requestTails = new Map<string, Promise<void>>()
const activeReads = new Set<Map<string, ReactionChange>>()

function key(backendUrl: string, statusId: string) {
  return JSON.stringify([backendUrl, statusId])
}

// A read already queued when an action succeeds can return the previous snapshot.
export function trackReactionRead() {
  const changes = new Map(pendingWrites)
  activeReads.add(changes)
  return {
    apply(items: TimelineItem[]) {
      if (!changes.size) return items
      return items.map((item) => {
        const status = 'type' in item ? item.status : item
        if (
          !status ||
          !('backendUrl' in item) ||
          typeof item.backendUrl !== 'string'
        )
          return item
        const change = changes.get(
          key(item.backendUrl, status.reblog?.id ?? status.id),
        )
        if (!change) return item
        const emoji_reactions = change.reactions
        const updated = {
          ...status,
          emoji_reactions,
          reblog: status.reblog && { ...status.reblog, emoji_reactions },
        }
        return 'type' in item
          ? { ...item, status: updated }
          : { ...item, ...updated }
      })
    },
    finish: () => activeReads.delete(changes),
  }
}

export async function changeEmojiReaction(
  app: App,
  statusId: string,
  emoji: string,
  add: boolean,
  onChange?: (reactions: Entity.Reaction[]) => void,
) {
  const id = key(app.backendUrl, statusId)
  const previous = requestTails.get(id)
  const turn = Promise.withResolvers<void>()
  requestTails.set(id, turn.promise)
  try {
    await previous
    const client = GetClient(app)
    const { data } = add
      ? await client.createEmojiReaction(statusId, emoji)
      : await client.deleteEmojiReaction(statusId, emoji)
    const reactions =
      data.emoji_reactions ??
      (await client
        .getEmojiReactions(statusId)
        .then((response) => response.data)
        .catch((error) => {
          console.error('Failed to read confirmed emoji reactions:', error)
          return undefined
        }))
    if (reactions) {
      const change = { reactions }
      pendingWrites.set(id, change)
      for (const read of activeReads) read.set(id, change)
      onChange?.(change.reactions)
    } else {
      pendingWrites.delete(id)
      for (const read of activeReads) read.delete(id)
    }
    await toggleReactionInDb(app.backendUrl, statusId, add, emoji)
    pendingWrites.delete(id)
  } finally {
    turn.resolve()
    if (requestTails.get(id) === turn.promise) requestTails.delete(id)
  }
}
