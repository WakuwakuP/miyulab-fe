import type { SchemaDbHandle } from '../../worker/workerSchema'
import type { Migration } from '../types'

export const v2_0_8_migration: Migration = {
  description:
    'Add display_post_id and created_at_ms indexes for cleanup and FK delete plans',

  up(handle: SchemaDbHandle) {
    const { db } = handle

    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_timeline_entries_display_post ON timeline_entries(display_post_id);',
    )
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_timeline_entries_created_at ON timeline_entries(created_at_ms, id);',
    )
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at_ms, id);',
    )
  },

  validate(handle: SchemaDbHandle): boolean {
    const { db } = handle

    const expected = [
      'idx_notifications_created_at',
      'idx_timeline_entries_created_at',
      'idx_timeline_entries_display_post',
    ]
    for (const name of expected) {
      const rows = db.exec(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?;",
        { bind: [name], returnValue: 'resultRows' },
      ) as string[][]
      if (rows.length === 0) {
        console.error(`Validation failed: ${name} index not found`)
        return false
      }
    }
    return true
  },

  version: { major: 2, minor: 0, patch: 8 },
}
