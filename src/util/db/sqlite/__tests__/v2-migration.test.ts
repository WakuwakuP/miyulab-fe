import { beforeEach, describe, expect, it, vi } from 'vitest'

// schema/index.ts のモック
vi.mock('util/db/sqlite/schema', () => ({
  createFreshSchema: vi.fn(),
  dropAllTables: vi.fn(),
}))

import { migrations, runMigrations } from 'util/db/sqlite/migrations'
import { v2_0_0_migration } from 'util/db/sqlite/migrations/v2.0.0'
import { createFreshSchema, dropAllTables } from 'util/db/sqlite/schema'
import { encodeSemVer } from 'util/db/sqlite/schema/version'
import type { SchemaDbHandle } from 'util/db/sqlite/worker/workerSchema'

// ─── Mock DB factory ────────────────────────────────────────────
function createMockDb(userVersion: number) {
  const db = {
    exec: vi.fn((sql: string, opts?: Record<string, unknown>) => {
      if (
        typeof sql === 'string' &&
        sql.includes('PRAGMA user_version') &&
        opts?.returnValue === 'resultRows'
      ) {
        return [[userVersion]]
      }
      return undefined
    }),
  }
  return { db, handle: { db } as SchemaDbHandle }
}

describe('v2.0.0 マイグレーション', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('メタデータ', () => {
    it('バージョンが {major: 2, minor: 0, patch: 0} である', () => {
      expect(v2_0_0_migration.version).toEqual({
        major: 2,
        minor: 0,
        patch: 0,
      })
    })

    it('説明文が定義されている', () => {
      expect(v2_0_0_migration.description).toBeDefined()
      expect(v2_0_0_migration.description.length).toBeGreaterThan(0)
    })
  })

  describe('up()', () => {
    it('dropAllTables を呼び出す', () => {
      const { handle } = createMockDb(0)
      v2_0_0_migration.up(handle)
      expect(dropAllTables).toHaveBeenCalledWith(handle)
    })

    it('createFreshSchema を呼び出す', () => {
      const { handle } = createMockDb(0)
      v2_0_0_migration.up(handle)
      expect(createFreshSchema).toHaveBeenCalledWith(handle)
    })

    it('dropAllTables → createFreshSchema の順序で呼び出す', () => {
      const callOrder: string[] = []
      vi.mocked(dropAllTables).mockImplementation(() => {
        callOrder.push('dropAllTables')
      })
      vi.mocked(createFreshSchema).mockImplementation(() => {
        callOrder.push('createFreshSchema')
      })

      const { handle } = createMockDb(0)
      v2_0_0_migration.up(handle)
      expect(callOrder).toEqual(['dropAllTables', 'createFreshSchema'])
    })
  })

  describe('validate()', () => {
    const requiredTables = [
      'servers',
      'visibility_types',
      'media_types',
      'notification_types',
      'card_types',
      'local_accounts',
      'profiles',
      'profile_stats',
      'profile_fields',
      'profile_custom_emojis',
      'posts',
      'post_backend_ids',
      'post_stats',
      'post_interactions',
      'post_emoji_reactions',
      'post_media',
      'post_mentions',
      'post_hashtags',
      'post_custom_emojis',
      'polls',
      'poll_votes',
      'poll_options',
      'link_cards',
      'custom_emojis',
      'hashtags',
      'notifications',
      'timeline_entries',
      'schema_version',
    ]

    it('全28テーブルが存在する場合にtrueを返す', () => {
      const db = {
        exec: vi.fn((sql: string, opts?: Record<string, unknown>) => {
          if (
            sql.includes('sqlite_master') &&
            opts?.returnValue === 'resultRows'
          ) {
            return [[1]]
          }
          return undefined
        }),
      }
      const handle = { db } as SchemaDbHandle
      expect(v2_0_0_migration.validate).toBeDefined()
      expect(v2_0_0_migration.validate?.(handle)).toBe(true)
      // 28テーブル分のクエリが発行される
      const masterCalls = db.exec.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' && call[0].includes('sqlite_master'),
      )
      expect(masterCalls).toHaveLength(requiredTables.length)
    })

    it('テーブルが不足している場合にfalseを返す', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const db = {
        exec: vi.fn((sql: string, opts?: Record<string, unknown>) => {
          if (
            sql.includes('sqlite_master') &&
            opts?.returnValue === 'resultRows'
          ) {
            // 'posts' テーブルだけ存在しないケース
            if (sql.includes("'posts'")) {
              return [[0]]
            }
            return [[1]]
          }
          return undefined
        }),
      }
      const handle = { db } as SchemaDbHandle
      expect(v2_0_0_migration.validate?.(handle)).toBe(false)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("table 'posts' not found"),
      )
      consoleSpy.mockRestore()
    })
  })

  describe('マイグレーションランナーとの統合', () => {
    const mockDropAll = vi.fn()
    const mockCreateFresh = vi.fn()

    beforeEach(() => {
      mockDropAll.mockReset()
      mockCreateFresh.mockReset()
    })

    it('migrations 配列に v2.0.0 が登録されている', () => {
      const found = migrations.find(
        (m) =>
          m.version.major === 2 &&
          m.version.minor === 0 &&
          m.version.patch === 0,
      )
      expect(found).toBeDefined()
      expect(found).toBe(v2_0_0_migration)
    })

    it('v28 (レガシー) DB に対して適用可能である', () => {
      // v28 → normalizeLegacyVersion → {1,0,0}
      // v2.0.0 > v1.0.0 なので適用される
      const savedMigrations = [...migrations]
      migrations.length = 0
      migrations.push(v2_0_0_migration)

      const { handle } = createMockDb(28)
      runMigrations(handle, mockDropAll, mockCreateFresh)

      // up() が呼ばれる → モック済み dropAllTables/createFreshSchema が呼ばれる
      expect(dropAllTables).toHaveBeenCalled()
      expect(createFreshSchema).toHaveBeenCalled()

      // 復元
      migrations.length = 0
      migrations.push(...savedMigrations)
    })

    it('v2.0.0 DB に対して v2.0.1 ~ v2.0.5 マイグレーションが適用される', () => {
      const v2Encoded = encodeSemVer({ major: 2, minor: 0, patch: 0 })
      let canonicalAcctAdded = false
      let usernameServerIndexCreated = false
      // 各マイグレーションの validate/up 用モック
      const db = {
        exec: vi.fn((sql: string, opts?: Record<string, unknown>) => {
          if (
            typeof sql === 'string' &&
            sql.includes('ALTER TABLE profiles ADD COLUMN canonical_acct')
          ) {
            canonicalAcctAdded = true
            return undefined
          }
          if (
            typeof sql === 'string' &&
            sql.includes('CREATE UNIQUE INDEX idx_profiles_username_server')
          ) {
            usernameServerIndexCreated = true
            return undefined
          }
          if (typeof sql === 'string' && opts?.returnValue === 'resultRows') {
            if (sql.includes('PRAGMA user_version')) {
              return [[v2Encoded]]
            }
            if (
              sql.includes('sqlite_master') &&
              sql.includes("name='idx_profiles_canonical_acct'")
            ) {
              return [
                [
                  'CREATE UNIQUE INDEX idx_profiles_canonical_acct ON profiles(canonical_acct)',
                ],
              ]
            }
            if (
              sql.includes('sqlite_master') &&
              sql.includes("name='idx_profiles_username_server'")
            ) {
              // up() 実行前は存在しない、実行後は存在する
              if (usernameServerIndexCreated) {
                return [
                  [
                    'CREATE UNIQUE INDEX idx_profiles_username_server ON profiles(username, server_id)',
                  ],
                ]
              }
              return []
            }
            if (sql.includes('sqlite_master')) {
              return [[1]]
            }
            if (sql.includes('notification_types')) {
              return [['emoji_reaction']]
            }
            if (sql.includes('PRAGMA table_info(profiles)')) {
              const base = [
                [0, 'id'],
                [1, 'actor_uri'],
                [2, 'username'],
                [3, 'server_id'],
                [4, 'acct'],
              ]
              if (canonicalAcctAdded) {
                return [...base, [5, 'canonical_acct']]
              }
              return base
            }
            if (
              sql.includes('COUNT(*)') &&
              sql.includes('_profile_merge_map')
            ) {
              return [[0]]
            }
            if (sql.includes('COUNT(*)') && sql.includes('canonical_acct')) {
              return [[0]]
            }
            if (
              sql.includes('COUNT(*)') &&
              sql.includes('username') &&
              sql.includes('server_id')
            ) {
              // v2.0.5 validate: 重複なし
              return [[0]]
            }
          }
          return undefined
        }),
      }
      const handle = { db } as SchemaDbHandle
      runMigrations(handle, mockDropAll, mockCreateFresh)

      // v2.0.1 の up() による CREATE TABLE (2) + v2.0.4 の _profile_merge_map (1) + v2.0.5 の _profile_merge_map_v205 (1)
      const createTableCalls = db.exec.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' && call[0].includes('CREATE TABLE'),
      )
      expect(createTableCalls).toHaveLength(4)
      // v2.0.2 の up() による UPDATE が実行される
      const updateCalls = db.exec.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('UPDATE notification_types'),
      )
      expect(updateCalls).toHaveLength(1)
      // v2.0.3 の up() による ALTER TABLE が実行される
      const alterCalls = db.exec.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('ALTER TABLE profiles ADD COLUMN canonical_acct'),
      )
      expect(alterCalls).toHaveLength(1)
      // v2.0.4 の up() による UNIQUE INDEX 作成が実行される
      const uniqueIndexCalls = db.exec.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('CREATE UNIQUE INDEX') &&
          call[0].includes('canonical_acct'),
      )
      expect(uniqueIndexCalls).toHaveLength(1)
      // v2.0.5 の up() による UNIQUE INDEX 作成が実行される
      const usernameServerIndexCalls = db.exec.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('CREATE UNIQUE INDEX') &&
          call[0].includes('username') &&
          call[0].includes('server_id'),
      )
      expect(usernameServerIndexCalls).toHaveLength(1)
      // フォールバック (DROP → 再作成) は使用されない
      expect(mockDropAll).not.toHaveBeenCalled()
      expect(mockCreateFresh).not.toHaveBeenCalled()
    })
  })
})
