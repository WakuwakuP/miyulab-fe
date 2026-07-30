import { resolveNotificationTypeId } from 'util/db/sqlite/worker/workerNotificationStore'
import { describe, expect, it } from 'vitest'

describe('vitest smoke test', () => {
  it('loads a SQLite worker module and resolves a known notification type', () => {
    const db = { exec: () => [] }

    expect(resolveNotificationTypeId(db, 'mention')).toBe(4)
  })
})
