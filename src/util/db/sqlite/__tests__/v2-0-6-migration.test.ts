import { v2_0_6_migration } from 'util/db/sqlite/migrations/v2.0.6'
import type { SchemaDbHandle } from 'util/db/sqlite/worker/workerSchema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

function createMockDb(indexExists: boolean) {
  const execCalls: { sql: string; opts?: Record<string, unknown> }[] = []
  const db = {
    exec: vi.fn((sql: string, opts?: Record<string, unknown>) => {
      execCalls.push({ opts, sql })
      if (
        typeof sql === 'string' &&
        sql.includes('sqlite_master') &&
        sql.includes("name='idx_timeline_entries_post'") &&
        opts?.returnValue === 'resultRows'
      ) {
        return indexExists
          ? [
              [
                'CREATE INDEX idx_timeline_entries_post ON timeline_entries(post_id)',
              ],
            ]
          : []
      }
      return undefined
    }),
  }
  return { db, execCalls, handle: { db } as SchemaDbHandle }
}

describe('v2.0.6 マイグレーション', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('メタデータ', () => {
    it('バージョンが {major: 2, minor: 0, patch: 6} である', () => {
      expect(v2_0_6_migration.version).toEqual({
        major: 2,
        minor: 0,
        patch: 6,
      })
    })

    it('説明文が定義されている', () => {
      expect(v2_0_6_migration.description).toBeDefined()
      expect(v2_0_6_migration.description.length).toBeGreaterThan(0)
    })
  })

  describe('up()', () => {
    it('timeline_entries(post_id) に CREATE INDEX IF NOT EXISTS を実行する', () => {
      const { handle, execCalls } = createMockDb(false)
      v2_0_6_migration.up(handle)

      const createIndexCall = execCalls.find(
        (c) =>
          c.sql.includes('CREATE INDEX') &&
          c.sql.includes('idx_timeline_entries_post'),
      )
      expect(createIndexCall).toBeDefined()
      expect(createIndexCall?.sql).toContain('IF NOT EXISTS')
      expect(createIndexCall?.sql).toContain('timeline_entries(post_id)')
    })

    it('冪等性: 既にインデックスが存在しても IF NOT EXISTS でエラーにならない', () => {
      const { handle } = createMockDb(true)
      expect(() => v2_0_6_migration.up(handle)).not.toThrow()
    })
  })

  describe('validate()', () => {
    it('idx_timeline_entries_post が存在すれば true を返す', () => {
      const { handle } = createMockDb(true)
      expect(v2_0_6_migration.validate?.(handle)).toBe(true)
    })

    it('idx_timeline_entries_post が存在しない場合は false を返す', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { handle } = createMockDb(false)
      expect(v2_0_6_migration.validate?.(handle)).toBe(false)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('idx_timeline_entries_post'),
      )
      consoleSpy.mockRestore()
    })
  })
})
