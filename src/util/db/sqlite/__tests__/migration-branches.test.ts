import { v2_0_4_migration } from 'util/db/sqlite/migrations/v2.0.4'
import { v2_0_5_migration } from 'util/db/sqlite/migrations/v2.0.5'
import { v28Migration } from 'util/db/sqlite/migrations/v28'
import { describe, expect, it, vi } from 'vitest'

type MigrationHandle = Parameters<typeof v2_0_4_migration.up>[0]

function makeHandle(
  implementation: (
    sql: string,
    options?: { returnValue?: string },
  ) => unknown = () => undefined,
): { exec: ReturnType<typeof vi.fn>; handle: MigrationHandle } {
  const exec = vi.fn(implementation)
  return {
    exec,
    handle: { db: { exec } } as unknown as MigrationHandle,
  }
}

describe('v28Migration', () => {
  it('adds and backfills all v28 columns and indexes', () => {
    const { exec, handle } = makeHandle()

    v28Migration.up(handle)

    const sql = exec.mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).toContain(
      'ALTER TABLE posts ADD COLUMN reply_to_post_id INTEGER',
    )
    expect(sql).toContain(
      'ALTER TABLE posts ADD COLUMN repost_of_post_id INTEGER',
    )
    expect(sql).toContain('UPDATE posts')
    expect(sql).toContain(
      'ALTER TABLE posts_mentions ADD COLUMN profile_id INTEGER',
    )
    expect(sql).toContain(
      'ALTER TABLE timelines ADD COLUMN local_account_id INTEGER',
    )
    expect(sql).toContain('DROP INDEX IF EXISTS idx_timelines_identity')
    expect(sql).toContain('CREATE UNIQUE INDEX idx_timelines_identity')
    expect(sql).toContain(
      'ALTER TABLE notifications ADD COLUMN local_account_id INTEGER',
    )
    expect(sql).toContain('UPDATE notifications')
    expect(sql).toContain(
      'ALTER TABLE local_accounts ADD COLUMN is_active INTEGER',
    )
    expect(sql).toContain(
      'ALTER TABLE local_accounts ADD COLUMN last_used_at_ms INTEGER',
    )
  })

  it('validates when every expected column exists', () => {
    const columns: Record<string, string[]> = {
      local_accounts: ['is_active', 'last_used_at_ms'],
      notifications: ['local_account_id'],
      posts: ['reply_to_post_id', 'repost_of_post_id'],
      posts_mentions: ['profile_id'],
      timelines: ['local_account_id'],
    }
    const { handle } = makeHandle((sql) => {
      const table = /PRAGMA table_info\(([^)]+)\)/.exec(sql)?.[1] ?? ''
      return (columns[table] ?? []).map((column) => [0, column])
    })

    expect(v28Migration.validate(handle)).toBe(true)
  })

  it('fails validation when any expected column is missing', () => {
    const { handle } = makeHandle((sql) => {
      const table = /PRAGMA table_info\(([^)]+)\)/.exec(sql)?.[1] ?? ''
      if (table === 'posts') return [[0, 'repost_of_post_id']]
      return []
    })

    expect(v28Migration.validate(handle)).toBe(false)
  })
})

describe('v2.0.4 migration', () => {
  it('skips reference rewrites when there are no duplicate profiles', () => {
    const { exec, handle } = makeHandle((sql) =>
      sql.includes('SELECT COUNT(*) FROM _profile_merge_map') ? [[0]] : [],
    )

    v2_0_4_migration.up(handle)

    const sql = exec.mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).not.toContain('UPDATE posts SET author_profile_id')
    expect(sql).toContain('DROP TABLE _profile_merge_map')
    expect(sql).toContain('CREATE UNIQUE INDEX idx_profiles_canonical_acct')
  })

  it('rewrites all profile references before deleting duplicates', () => {
    const { exec, handle } = makeHandle((sql) =>
      sql.includes('SELECT COUNT(*) FROM _profile_merge_map') ? [[2]] : [],
    )

    v2_0_4_migration.up(handle)

    const sql = exec.mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).toContain('UPDATE posts SET author_profile_id')
    expect(sql).toContain('UPDATE post_mentions SET profile_id')
    expect(sql).toContain('UPDATE notifications SET actor_profile_id')
    expect(sql).toContain('UPDATE local_accounts SET profile_id')
    expect(sql).toContain('UPDATE profiles SET moved_to_profile_id')
    expect(sql).toContain('DELETE FROM profiles')
  })

  it.each([
    {
      duplicateCount: 1,
      expected: false,
      indexRows: [['CREATE UNIQUE INDEX idx ON profiles(canonical_acct)']],
      name: 'duplicates remain',
    },
    {
      duplicateCount: 0,
      expected: false,
      indexRows: [],
      name: 'index is missing',
    },
    {
      duplicateCount: 0,
      expected: false,
      indexRows: [['CREATE INDEX idx ON profiles(canonical_acct)']],
      name: 'index is not unique',
    },
    {
      duplicateCount: 0,
      expected: true,
      indexRows: [['CREATE UNIQUE INDEX idx ON profiles(canonical_acct)']],
      name: 'data and index are valid',
    },
  ])(
    'returns $expected when $name',
    ({ duplicateCount, expected, indexRows }) => {
      const { handle } = makeHandle((sql) => {
        if (sql.includes('HAVING COUNT(*) > 1')) return [[duplicateCount]]
        if (sql.includes("type='index'")) return indexRows
        return []
      })
      vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(v2_0_4_migration.validate(handle)).toBe(expected)
    },
  )
})

describe('v2.0.5 migration', () => {
  it('is idempotent when the unique index already exists', () => {
    const { exec, handle } = makeHandle((sql) =>
      sql.includes("type='index'") ? [['CREATE UNIQUE INDEX existing']] : [],
    )

    v2_0_5_migration.up(handle)

    expect(exec).toHaveBeenCalledOnce()
  })

  it('creates the index without rewrites when there are no duplicates', () => {
    const { exec, handle } = makeHandle((sql) => {
      if (sql.includes("type='index'")) return []
      if (sql.includes('SELECT COUNT(*) FROM _profile_merge_map_v205')) {
        return [[0]]
      }
      return []
    })

    v2_0_5_migration.up(handle)

    const sql = exec.mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).not.toContain('UPDATE posts SET author_profile_id')
    expect(sql).toContain('DROP TABLE _profile_merge_map_v205')
    expect(sql).toContain('CREATE UNIQUE INDEX idx_profiles_username_server')
  })

  it('rewrites all profile references before deleting duplicates', () => {
    const { exec, handle } = makeHandle((sql) => {
      if (sql.includes("type='index'")) return []
      if (sql.includes('SELECT COUNT(*) FROM _profile_merge_map_v205')) {
        return [[3]]
      }
      return []
    })

    v2_0_5_migration.up(handle)

    const sql = exec.mock.calls.map(([statement]) => statement).join('\n')
    expect(sql).toContain('UPDATE posts SET author_profile_id')
    expect(sql).toContain('UPDATE post_mentions SET profile_id')
    expect(sql).toContain('UPDATE notifications SET actor_profile_id')
    expect(sql).toContain('UPDATE local_accounts SET profile_id')
    expect(sql).toContain('UPDATE profiles SET moved_to_profile_id')
    expect(sql).toContain('DELETE FROM profiles')
  })

  it.each([
    {
      duplicateCount: 2,
      expected: false,
      indexRows: [['CREATE UNIQUE INDEX idx ON profiles(username, server_id)']],
      name: 'duplicates remain',
    },
    {
      duplicateCount: 0,
      expected: false,
      indexRows: [],
      name: 'index is missing',
    },
    {
      duplicateCount: 0,
      expected: false,
      indexRows: [['CREATE INDEX idx ON profiles(username, server_id)']],
      name: 'index is not unique',
    },
    {
      duplicateCount: 0,
      expected: true,
      indexRows: [['CREATE UNIQUE INDEX idx ON profiles(username, server_id)']],
      name: 'data and index are valid',
    },
  ])(
    'returns $expected when $name',
    ({ duplicateCount, expected, indexRows }) => {
      const { handle } = makeHandle((sql) => {
        if (sql.includes('HAVING COUNT(*) > 1')) return [[duplicateCount]]
        if (sql.includes("type='index'")) return indexRows
        return []
      })
      vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(v2_0_5_migration.validate(handle)).toBe(expected)
    },
  )
})
