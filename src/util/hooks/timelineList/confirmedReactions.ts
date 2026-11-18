import type { Entity } from 'megalodon'
import type { TimelineItem } from 'types/timelineViewModel'
import type { App } from 'types/types'
import { toggleReactionInDb } from 'util/db/sqlite/statusStore'
import { GetClient } from 'util/GetClient'

type ReactionChange = { reactions: Entity.Reaction[] }
const pendingWrites = new Map<string, ReactionChange>()
const requestTails = new Map<string, Promise<Entity.Reaction[]>>()
const activeReads = new Set<Map<string, ReactionChange>>()

const loginIds = new WeakMap<App, number>()
let nextLoginId = 0

function key(app: App, statusId: string) {
  let loginId = loginIds.get(app)
  if (loginId === undefined) {
    loginId = ++nextLoginId
    loginIds.set(app, loginId)
  }
  return JSON.stringify([loginId, statusId])
}

// A read already queued when an action succeeds can return the previous snapshot.
export function trackReactionRead(apps: readonly App[]) {
  const changes = new Map(pendingWrites)
  activeReads.add(changes)
  return {
    apply(items: TimelineItem[]) {
      if (!changes.size) return items
      return items.map((item) => {
        const status = 'type' in item ? item.status : item
        const app = apps[item.appIndex]
        if (
          !status ||
          !app ||
          ('backendUrl' in item &&
            item.backendUrl &&
            item.backendUrl !== app.backendUrl)
        )
          return item
        const change = changes.get(key(app, status.reblog?.id ?? status.id))
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

function applyConfirmedChange(
  previous: Entity.Reaction[],
  emoji: string,
  add: boolean,
  single: boolean,
) {
  const name = (value: string) => value.replace(/^:(.+):$/, '$1')
  const result: Entity.Reaction[] = []
  let found = false
  for (const reaction of previous) {
    const matches = name(reaction.name) === name(emoji)
    found ||= matches
    const me = matches ? add : reaction.me && !(add && single)
    const count = reaction.count + Number(me) - Number(reaction.me)
    if (count > 0) result.push({ ...reaction, count, me })
  }
  if (add && !found) result.push({ count: 1, me: true, name: emoji })
  return result
}

export async function changeEmojiReaction(
  app: App,
  statusId: string,
  emoji: string,
  add: boolean,
  onChange?: (reactions: Entity.Reaction[]) => void,
  displayed: Entity.Reaction[] = [],
  remoteAccountId?: string | null,
) {
  const id = key(app, statusId)
  const previous = requestTails.get(id)
  const turn = Promise.withResolvers<Entity.Reaction[]>()
  requestTails.set(id, turn.promise)
  let latest = pendingWrites.get(id)?.reactions ?? displayed
  try {
    latest = (await previous) ?? latest
    const client = GetClient(app)
    const loginId =
      remoteAccountId ?? (await client.verifyAccountCredentials()).data.id
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
    latest =
      reactions ??
      applyConfirmedChange(
        latest,
        emoji,
        add,
        app.backend === 'misskey' || app.backend === 'firefish',
      )
    const change = { reactions: latest }
    pendingWrites.set(id, change)
    for (const read of activeReads) read.set(id, change)
    onChange?.(latest)
    try {
      await toggleReactionInDb(
        app.backendUrl,
        statusId,
        add,
        emoji,
        latest,
        loginId,
      )
    } catch (error) {
      // Keep in-flight reads consistent while allowing later sync to recover.
      setTimeout(() => {
        if (pendingWrites.get(id) === change) pendingWrites.delete(id)
      }, 60_000)
      throw error
    }
    pendingWrites.delete(id)
  } finally {
    turn.resolve(latest)
    if (requestTails.get(id) === turn.promise) requestTails.delete(id)
  }
}
