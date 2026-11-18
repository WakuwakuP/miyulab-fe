import type { TimelineItem } from 'types/timelineViewModel'
import type { App } from 'types/types'
import { expect, it, vi } from 'vitest'
import { changeEmojiReaction, trackReactionRead } from '../confirmedReactions'

const { create, remove, readReactions, save } = vi.hoisted(() => ({
  create: vi.fn(),
  readReactions: vi.fn(),
  remove: vi.fn(),
  save: vi.fn(),
}))
vi.mock('util/GetClient', () => ({
  GetClient: () => ({
    createEmojiReaction: create,
    deleteEmojiReaction: remove,
    getEmojiReactions: readReactions,
  }),
}))
vi.mock('util/db/sqlite/statusStore', () => ({ toggleReactionInDb: save }))

it('publishes before persistence and protects stale reads across a failed write and retry', async () => {
  const app = { backendUrl: 'a' } as App
  const apps = [app, { ...app }]
  const rows = [
    { appIndex: 0, backendUrl: 'a', emoji_reactions: [], id: '1' },
    { appIndex: 1, backendUrl: 'a', emoji_reactions: [], id: '1' },
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
  const read = trackReactionRead(apps)
  const request = changeEmojiReaction(app, '1', '⭐', true, publish)
  await started.promise
  expect(publish).toHaveBeenCalledWith(reactions)
  const nextReactions = [{ count: 1, me: true, name: '🎉' }]
  create.mockResolvedValueOnce({ data: { emoji_reactions: nextReactions } })
  const laterRead = trackReactionRead(apps)
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
    expect(snapshot.apply(rows)[1]).toBe(rows[1])
    snapshot.finish()
  }
  const afterSave = trackReactionRead(apps)
  expect(afterSave.apply(rows)).toBe(rows)
  afterSave.finish()
})

it('publishes a fetched empty list after deletion while another post is busy', async () => {
  const app = { backendUrl: 'a' } as App
  const saving = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  save.mockImplementationOnce(() => {
    started.resolve()
    return saving.promise
  })
  create.mockResolvedValueOnce({ data: { emoji_reactions: [] } })
  const first = changeEmojiReaction(app, 'busy', '⭐', true)
  await started.promise
  const publish = vi.fn()
  remove.mockResolvedValueOnce({ data: {} })
  readReactions.mockResolvedValueOnce({ data: [] })
  await changeEmojiReaction(app, 'other', '⭐', false, publish)
  expect(remove).toHaveBeenCalledWith('other', '⭐')
  expect(readReactions).toHaveBeenCalledWith('other')
  expect(publish).toHaveBeenCalledWith([])
  saving.resolve()
  await first
})
