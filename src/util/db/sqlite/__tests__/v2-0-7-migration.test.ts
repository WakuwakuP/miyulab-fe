import { v2_0_7_migration } from 'util/db/sqlite/migrations/v2.0.7'
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
        sql.includes("name='idx_posts_canonical_url'") &&
        opts?.returnValue === 'resultRows'
      ) {
        return indexExists
          ? [['CREATE INDEX idx_posts_canonical_url ON posts(canonical_url)']]
          : []
      }
      return undefined
    }),
  }
  return { db, execCalls, handle: { db } as SchemaDbHandle }
}

describe('v2.0.7 マイグレーション', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('メタデータ', () => {
    it('バージョンが {major: 2, minor: 0, patch: 7} である', () => {
      expect(v2_0_7_migration.version).toEqual({
        major: 2,
        minor: 0,
        patch: 7,
      })
    })

    it('説明文が定義されている', () => {
      expect(v2_0_7_migration.description).toBeDefined()
      expect(v2_0_7_migration.description.length).toBeGreaterThan(0)
    })
  })

  describe('up()', () => {
    it('posts(canonical_url) に CREATE INDEX IF NOT EXISTS を実行する', () => {
      const { handle, execCalls } = createMockDb(false)
      v2_0_7_migration.up(handle)

      const createIndexCall = execCalls.find(
        (c) =>
          c.sql.includes('CREATE INDEX') &&
          c.sql.includes('idx_posts_canonical_url'),
      )
      expect(createIndexCall).toBeDefined()
      expect(createIndexCall?.sql).toContain('IF NOT EXISTS')
      expect(createIndexCall?.sql).toContain('posts(canonical_url)')
      expect(createIndexCall?.sql).toContain('canonical_url IS NOT NULL')
      expect(createIndexCall?.sql).toContain("canonical_url != ''")
    })

    it('冪等性: 既にインデックスが存在しても IF NOT EXISTS でエラーにならない', () => {
      const { handle } = createMockDb(true)
      expect(() => v2_0_7_migration.up(handle)).not.toThrow()
    })
  })

  describe('validate()', () => {
    it('idx_posts_canonical_url が存在すれば true を返す', () => {
      const { handle } = createMockDb(true)
      expect(v2_0_7_migration.validate?.(handle)).toBe(true)
    })

    it('idx_posts_canonical_url が存在しない場合は false を返す', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { handle } = createMockDb(false)
      expect(v2_0_7_migration.validate?.(handle)).toBe(false)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('idx_posts_canonical_url'),
      )
      consoleSpy.mockRestore()
    })
  })
})
