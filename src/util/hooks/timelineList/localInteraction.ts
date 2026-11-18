import type { Entity } from 'megalodon'

export type LocalInteraction = {
  appIndex: number
  backendUrl: string
  statusId: string
  updates: Partial<
    Pick<
      Entity.Status,
      'favourited' | 'reblogged' | 'bookmarked' | 'emoji_reactions'
    >
  >
}

const listeners = new Set<(change: LocalInteraction) => void>()

export function subscribeLocalInteraction(
  listener: (change: LocalInteraction) => void,
) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function publishLocalInteraction(change: LocalInteraction) {
  for (const listener of listeners) listener(change)
}
