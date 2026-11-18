import type { TimelineItem } from 'types/timelineViewModel'
import type { App } from 'types/types'
import { expect, it, vi } from 'vitest'
import { changeEmojiReaction, trackReactionRead } from '../confirmedReactions'

const { create, save } = vi.hoisted(() => ({ create: vi.fn(), save: vi.fn() }))
vi.mock('util/GetClient', () => ({
  GetClient: () => ({ createEmojiReaction: create }),
}))
vi.mock('util/db/sqlite/statusStore', () => ({ toggleReactionInDb: save }))

it('publishes before persistence and protects stale reads across a failed write and retry', async () => {
  const app = { backendUrl: 'a' } as App
  const rows = [
    { backendUrl: 'a', emoji_reactions: [], id: '1' },
  ] as unknown as TimelineItem[]
  const reactions = [{ count: 1, me: true, name: '⭐' }]
  const publish = vi.fn()
  const started = Promise.withResolvers<void>()
  const saving = Promise.withResolvers<void>()
  create.mockResolvedValue({ data: { emoji_reactions: reactions } })
  save.mockImplementationOnce(() => {
    started.resolve()
    return saving.promise
  })
  const read = trackReactionRead()
  const request = changeEmojiReaction(app, '1', '⭐', true, publish)
  await started.promise
  expect(publish).toHaveBeenCalledWith(reactions)
  const nextReactions = [{ count: 1, me: true, name: '🎉' }]
  create.mockResolvedValueOnce({ data: { emoji_reactions: nextReactions } })
  const laterRead = trackReactionRead()
  const queued = changeEmojiReaction(app, '1', '🎉', true, publish)
  expect(create).toHaveBeenCalledTimes(1)
  saving.reject(new Error('write failed'))
  await expect(request).rejects.toThrow('write failed')
  await queued
  expect(create).toHaveBeenLastCalledWith('1', '🎉')
  expect(publish).toHaveBeenLastCalledWith(nextReactions)
  for (const snapshot of [read, laterRead]) {
    expect(snapshot.apply(rows)[0]).toMatchObject({
      emoji_reactions: nextReactions,
    })
    snapshot.finish()
  }
  const afterSave = trackReactionRead()
  expect(afterSave.apply(rows)).toBe(rows)
  afterSave.finish()
})
