import { createFreshSchema, dropAllTables } from 'util/db/sqlite/schema/index'
import { createAccountTables } from 'util/db/sqlite/schema/tables/accounts'
import { createCardTables } from 'util/db/sqlite/schema/tables/cards'
import { createInteractionTables } from 'util/db/sqlite/schema/tables/interactions'
import { createLookupTables } from 'util/db/sqlite/schema/tables/lookup'
import { createMetaTables } from 'util/db/sqlite/schema/tables/meta'
import { createNotificationTables } from 'util/db/sqlite/schema/tables/notifications'
import { createPollTables } from 'util/db/sqlite/schema/tables/polls'
import { createPostRelatedTables } from 'util/db/sqlite/schema/tables/postRelated'
import { createPostTables } from 'util/db/sqlite/schema/tables/posts'
import { createProfileTables } from 'util/db/sqlite/schema/tables/profiles'
import { createRegistryTables } from 'util/db/sqlite/schema/tables/registries'
import { createTimelineTables } from 'util/db/sqlite/schema/tables/timeline'
import type { SchemaDbHandle } from 'util/db/sqlite/worker/workerSchema'
import { describe, expect, it, vi } from 'vitest'

// ─── Mock DB factory ────────────────────────────────────────────
function createMockDb() {
  const execCalls: string[] = []
  const db = {
    exec: vi.fn((sql: string, opts?: Record<string, unknown>) => {
      execCalls.push(sql)
      if (opts?.returnValue === 'resultRows') {
        return []
      }
      return undefined
    }),
  }
  return { db, execCalls }
}

// ─── ヘルパー ────────────────────────────────────────────────────
function sqlContainsTable(calls: string[], tableName: string): boolean {
  return calls.some(
    (sql) => sql.includes('CREATE TABLE') && sql.includes(tableName),
  )
}

function sqlContainsIndex(calls: string[], indexName: string): boolean {
  return calls.some(
    (sql) =>
      sql.includes('CREATE') &&
      sql.includes('INDEX') &&
      sql.includes(indexName),
  )
}

describe('スキーマ定義', () => {
  // ═══════════════════════════════════════════════════════════════
  describe('createLookupTables', () => {
    it('servers テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createLookupTables(db)
      expect(sqlContainsTable(execCalls, 'servers')).toBe(true)
    })

    it('visibility_types テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createLookupTables(db)
      expect(sqlContainsTable(execCalls, 'visibility_types')).toBe(true)
    })

    it('media_types テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createLookupTables(db)
      expect(sqlContainsTable(execCalls, 'media_types')).toBe(true)
    })

    it('notification_types テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createLookupTables(db)
      expect(sqlContainsTable(execCalls, 'notification_types')).toBe(true)
    })

    it('card_types テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createLookupTables(db)
      expect(sqlContainsTable(execCalls, 'card_types')).toBe(true)
    })

    it('visibility_types のシードデータを投入する（5件: public, unlisted, private, direct, local）', () => {
      const { db, execCalls } = createMockDb()
      createLookupTables(db)
      const seedSql = execCalls.find(
        (sql) => sql.includes('INSERT') && sql.includes('visibility_types'),
      )
      expect(seedSql).toBeDefined()
      for (const name of ['public', 'unlisted', 'private', 'direct', 'local']) {
        expect(seedSql).toContain(name)
      }
    })

    it('media_types のシードデータを投入する（5件: unknown, image, gifv, video, audio）', () => {
      const { db, execCalls } = createMockDb()
      createLookupTables(db)
      const seedSql = execCalls.find(
        (sql) => sql.includes('INSERT') && sql.includes('media_types'),
      )
      expect(seedSql).toBeDefined()
      for (const name of ['unknown', 'image', 'gifv', 'video', 'audio']) {
        expect(seedSql).toContain(name)
      }
    })

    it('notification_types のシードデータを投入する（19件）', () => {
      const { db, execCalls } = createMockDb()
      createLookupTables(db)
      const seedSql = execCalls.find(
        (sql) => sql.includes('INSERT') && sql.includes('notification_types'),
      )
      expect(seedSql).toBeDefined()
      // 19件の主要な通知タイプをチェック
      for (const name of [
        'follow',
        'favourite',
        'reblog',
        'mention',
        'reaction',
        'unknown',
      ]) {
        expect(seedSql).toContain(name)
      }
    })

    it('card_types のシードデータを投入する（4件: link, photo, video, rich）', () => {
      const { db, execCalls } = createMockDb()
      createLookupTables(db)
      const seedSql = execCalls.find(
        (sql) => sql.includes('INSERT') && sql.includes('card_types'),
      )
      expect(seedSql).toBeDefined()
      for (const name of ['link', 'photo', 'video', 'rich']) {
        expect(seedSql).toContain(name)
      }
    })
  })

  // ═══════════════════════════════════════════════════════════════
  describe('createAccountTables', () => {
    it('local_accounts テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createAccountTables(db)
      expect(sqlContainsTable(execCalls, 'local_accounts')).toBe(true)
    })

    it('idx_local_accounts_active インデックスを作成する', () => {
      const { db, execCalls } = createMockDb()
      createAccountTables(db)
      expect(sqlContainsIndex(execCalls, 'idx_local_accounts_active')).toBe(
        true,
      )
    })

    it('idx_local_accounts_server インデックスを作成する', () => {
      const { db, execCalls } = createMockDb()
      createAccountTables(db)
      expect(sqlContainsIndex(execCalls, 'idx_local_accounts_server')).toBe(
        true,
      )
    })
  })

  // ═══════════════════════════════════════════════════════════════
  describe('createProfileTables', () => {
    it('profiles テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createProfileTables(db)
      expect(sqlContainsTable(execCalls, 'profiles')).toBe(true)
    })

    it('profile_stats テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createProfileTables(db)
      expect(sqlContainsTable(execCalls, 'profile_stats')).toBe(true)
    })

    it('profile_fields テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createProfileTables(db)
      expect(sqlContainsTable(execCalls, 'profile_fields')).toBe(true)
    })

    it('profile_custom_emojis テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createProfileTables(db)
      expect(sqlContainsTable(execCalls, 'profile_custom_emojis')).toBe(true)
    })

    it('profiles テーブルに acct, actor_uri, server インデックスを作成する', () => {
      const { db, execCalls } = createMockDb()
      createProfileTables(db)
      expect(sqlContainsIndex(execCalls, 'idx_profiles_acct')).toBe(true)
      expect(sqlContainsIndex(execCalls, 'idx_profiles_actor_uri')).toBe(true)
      expect(sqlContainsIndex(execCalls, 'idx_profiles_server')).toBe(true)
    })

    it('profile_fields テーブルに profile インデックスを作成する', () => {
      const { db, execCalls } = createMockDb()
      createProfileTables(db)
      expect(sqlContainsIndex(execCalls, 'idx_profile_fields_profile')).toBe(
        true,
      )
    })

    it('profile_custom_emojis テーブルに profile インデックスを作成する', () => {
      const { db, execCalls } = createMockDb()
      createProfileTables(db)
      expect(
        sqlContainsIndex(execCalls, 'idx_profile_custom_emojis_profile'),
      ).toBe(true)
    })
  })

  // ═══════════════════════════════════════════════════════════════
  describe('createPostTables', () => {
    it('posts テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createPostTables(db)
      expect(sqlContainsTable(execCalls, 'posts')).toBe(true)
    })

    it('post_backend_ids テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createPostTables(db)
      expect(sqlContainsTable(execCalls, 'post_backend_ids')).toBe(true)
    })

    it('post_stats テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createPostTables(db)
      expect(sqlContainsTable(execCalls, 'post_stats')).toBe(true)
    })

    it('posts テーブルに object_uri, author, created, reblog_of, quote_of, reply, origin_server インデックスを作成する', () => {
      const { db, execCalls } = createMockDb()
      createPostTables(db)
      expect(sqlContainsIndex(execCalls, 'idx_posts_object_uri')).toBe(true)
      expect(sqlContainsIndex(execCalls, 'idx_posts_author')).toBe(true)
      expect(sqlContainsIndex(execCalls, 'idx_posts_created')).toBe(true)
      expect(sqlContainsIndex(execCalls, 'idx_posts_reblog_of')).toBe(true)
      expect(sqlContainsIndex(execCalls, 'idx_posts_quote_of')).toBe(true)
      expect(sqlContainsIndex(execCalls, 'idx_posts_reply')).toBe(true)
      expect(sqlContainsIndex(execCalls, 'idx_posts_origin_server')).toBe(true)
    })

    it('post_backend_ids テーブルに post, local, server インデックスを作成する', () => {
      const { db, execCalls } = createMockDb()
      createPostTables(db)
      expect(sqlContainsIndex(execCalls, 'idx_post_backend_ids_post')).toBe(
        true,
      )
      expect(sqlContainsIndex(execCalls, 'idx_post_backend_ids_local')).toBe(
        true,
      )
      expect(sqlContainsIndex(execCalls, 'idx_post_backend_ids_server')).toBe(
        true,
      )
    })
  })

  // ═══════════════════════════════════════════════════════════════
  describe('createPostRelatedTables', () => {
    it('post_media テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createPostRelatedTables(db)
      expect(sqlContainsTable(execCalls, 'post_media')).toBe(true)
    })

    it('post_mentions テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createPostRelatedTables(db)
      expect(sqlContainsTable(execCalls, 'post_mentions')).toBe(true)
    })

    it('post_hashtags テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createPostRelatedTables(db)
      expect(sqlContainsTable(execCalls, 'post_hashtags')).toBe(true)
    })

    it('post_custom_emojis テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createPostRelatedTables(db)
      expect(sqlContainsTable(execCalls, 'post_custom_emojis')).toBe(true)
    })

    it('各テーブルに適切なインデックスを作成する', () => {
      const { db, execCalls } = createMockDb()
      createPostRelatedTables(db)
      expect(sqlContainsIndex(execCalls, 'idx_post_media_post')).toBe(true)
      expect(sqlContainsIndex(execCalls, 'idx_post_mentions_post')).toBe(true)
      expect(sqlContainsIndex(execCalls, 'idx_post_mentions_acct')).toBe(true)
      expect(sqlContainsIndex(execCalls, 'idx_post_hashtags_post')).toBe(true)
      expect(sqlContainsIndex(execCalls, 'idx_post_hashtags_hashtag')).toBe(
        true,
      )
      expect(sqlContainsIndex(execCalls, 'idx_post_custom_emojis_post')).toBe(
        true,
      )
    })
  })

  // ═══════════════════════════════════════════════════════════════
  describe('createInteractionTables', () => {
    it('post_interactions テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createInteractionTables(db)
      expect(sqlContainsTable(execCalls, 'post_interactions')).toBe(true)
    })

    it('post_emoji_reactions テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createInteractionTables(db)
      expect(sqlContainsTable(execCalls, 'post_emoji_reactions')).toBe(true)
    })

    it('post_interactions テーブルに account, bookmarked, favourited インデックスを作成する', () => {
      const { db, execCalls } = createMockDb()
      createInteractionTables(db)
      expect(sqlContainsIndex(execCalls, 'idx_post_interactions_account')).toBe(
        true,
      )
      expect(
        sqlContainsIndex(execCalls, 'idx_post_interactions_bookmarked'),
      ).toBe(true)
      expect(
        sqlContainsIndex(execCalls, 'idx_post_interactions_favourited'),
      ).toBe(true)
    })

    it('post_emoji_reactions テーブルに post インデックスを作成する', () => {
      const { db, execCalls } = createMockDb()
      createInteractionTables(db)
      expect(sqlContainsIndex(execCalls, 'idx_post_emoji_reactions_post')).toBe(
        true,
      )
    })
  })

  // ═══════════════════════════════════════════════════════════════
  describe('createPollTables', () => {
    it('polls テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createPollTables(db)
      expect(sqlContainsTable(execCalls, 'polls')).toBe(true)
    })

    it('poll_votes テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createPollTables(db)
      expect(sqlContainsTable(execCalls, 'poll_votes')).toBe(true)
    })

    it('poll_options テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createPollTables(db)
      expect(sqlContainsTable(execCalls, 'poll_options')).toBe(true)
    })

    it('poll_votes と poll_options テーブルにインデックスを作成する', () => {
      const { db, execCalls } = createMockDb()
      createPollTables(db)
      expect(sqlContainsIndex(execCalls, 'idx_poll_votes_poll')).toBe(true)
      expect(sqlContainsIndex(execCalls, 'idx_poll_options_poll')).toBe(true)
    })
  })

  // ═══════════════════════════════════════════════════════════════
  describe('createCardTables', () => {
    it('link_cards テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createCardTables(db)
      expect(sqlContainsTable(execCalls, 'link_cards')).toBe(true)
    })
  })

  // ═══════════════════════════════════════════════════════════════
  describe('createRegistryTables', () => {
    it('custom_emojis テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createRegistryTables(db)
      expect(sqlContainsTable(execCalls, 'custom_emojis')).toBe(true)
    })

    it('hashtags テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createRegistryTables(db)
      expect(sqlContainsTable(execCalls, 'hashtags')).toBe(true)
    })

    it('custom_emojis テーブルに server インデックスを作成する', () => {
      const { db, execCalls } = createMockDb()
      createRegistryTables(db)
      expect(sqlContainsIndex(execCalls, 'idx_custom_emojis_server')).toBe(true)
    })
  })

  // ═══════════════════════════════════════════════════════════════
  describe('createTimelineTables', () => {
    it('timeline_entries テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createTimelineTables(db)
      expect(sqlContainsTable(execCalls, 'timeline_entries')).toBe(true)
    })

    it('idx_timeline_entries_feed インデックスを作成する', () => {
      const { db, execCalls } = createMockDb()
      createTimelineTables(db)
      expect(sqlContainsIndex(execCalls, 'idx_timeline_entries_feed')).toBe(
        true,
      )
    })
  })

  // ═══════════════════════════════════════════════════════════════
  describe('createNotificationTables', () => {
    it('notifications テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createNotificationTables(db)
      expect(sqlContainsTable(execCalls, 'notifications')).toBe(true)
    })

    it('notifications テーブルに5つのインデックスを作成する', () => {
      const { db, execCalls } = createMockDb()
      createNotificationTables(db)
      expect(
        sqlContainsIndex(execCalls, 'idx_notifications_account_created'),
      ).toBe(true)
      expect(sqlContainsIndex(execCalls, 'idx_notifications_type')).toBe(true)
      expect(sqlContainsIndex(execCalls, 'idx_notifications_unread')).toBe(true)
      expect(sqlContainsIndex(execCalls, 'idx_notifications_actor')).toBe(true)
      expect(sqlContainsIndex(execCalls, 'idx_notifications_post')).toBe(true)
    })
  })

  // ═══════════════════════════════════════════════════════════════
  describe('createMetaTables', () => {
    it('schema_version テーブルを作成する', () => {
      const { db, execCalls } = createMockDb()
      createMetaTables(db)
      expect(sqlContainsTable(execCalls, 'schema_version')).toBe(true)
      // version カラムは TEXT PRIMARY KEY（SemVer 文字列を格納するため）
      const createSql = execCalls.find((sql) => sql.includes('schema_version'))
      expect(createSql).toContain('TEXT PRIMARY KEY')
    })
  })

  // ═══════════════════════════════════════════════════════════════
  describe('createFreshSchema', () => {
    it('12個の create*Tables 関数をFK依存順に呼び出す', () => {
      const { db, execCalls } = createMockDb()
      const handle = { db } as SchemaDbHandle
      createFreshSchema(handle)

      // FK 依存順を確認: lookup → registries → profiles → accounts → posts → ...
      const lookupIdx = execCalls.findIndex((sql) =>
        /CREATE TABLE.*\bservers\b/.test(sql),
      )
      const registriesIdx = execCalls.findIndex((sql) =>
        /CREATE TABLE.*\bcustom_emojis\b/.test(sql),
      )
      const profilesIdx = execCalls.findIndex((sql) =>
        /CREATE TABLE IF NOT EXISTS profiles\s*\(/.test(sql),
      )
      const accountsIdx = execCalls.findIndex((sql) =>
        /CREATE TABLE.*\blocal_accounts\b/.test(sql),
      )
      const postsIdx = execCalls.findIndex((sql) =>
        /CREATE TABLE IF NOT EXISTS posts\s*\(/.test(sql),
      )
      const metaIdx = execCalls.findIndex((sql) =>
        /CREATE TABLE.*\bschema_version\b/.test(sql),
      )

      expect(lookupIdx).toBeLessThan(registriesIdx)
      expect(registriesIdx).toBeLessThan(profilesIdx)
      expect(profilesIdx).toBeLessThan(accountsIdx)
      expect(accountsIdx).toBeLessThan(postsIdx)
      expect(postsIdx).toBeLessThan(metaIdx)
    })

    it('合計28テーブルの CREATE TABLE 文を生成する', () => {
      const { db, execCalls } = createMockDb()
      const handle = { db } as SchemaDbHandle
      createFreshSchema(handle)

      const createTableCalls = execCalls.filter((sql) =>
        sql.includes('CREATE TABLE'),
      )
      expect(createTableCalls).toHaveLength(28)
    })
  })

  // ═══════════════════════════════════════════════════════════════
  describe('dropAllTables', () => {
    it('sqlite_master から全テーブル名を取得する', () => {
      const { db } = createMockDb()
      const handle = { db } as SchemaDbHandle
      dropAllTables(handle)

      expect(db.exec).toHaveBeenCalledWith(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';",
        { returnValue: 'resultRows' },
      )
    })

    it('PRAGMA foreign_keys = OFF で FK を無効化してから DROP する', () => {
      const execCalls: string[] = []
      const db = {
        exec: vi.fn((sql: string, opts?: Record<string, unknown>) => {
          execCalls.push(sql)
          if (opts?.returnValue === 'resultRows') {
            return [['posts'], ['profiles']]
          }
          return undefined
        }),
      }
      const handle = { db } as SchemaDbHandle
      dropAllTables(handle)

      const fkOffIdx = execCalls.indexOf('PRAGMA foreign_keys = OFF;')
      const dropPostsIdx = execCalls.findIndex(
        (sql) => sql.includes('DROP TABLE') && sql.includes('posts'),
      )
      const dropProfilesIdx = execCalls.findIndex(
        (sql) => sql.includes('DROP TABLE') && sql.includes('profiles'),
      )

      expect(fkOffIdx).toBeGreaterThan(-1)
      expect(dropPostsIdx).toBeGreaterThan(fkOffIdx)
      expect(dropProfilesIdx).toBeGreaterThan(fkOffIdx)
    })

    it('DROP 後に PRAGMA foreign_keys = ON で FK を再有効化する', () => {
      const execCalls: string[] = []
      const db = {
        exec: vi.fn((sql: string, opts?: Record<string, unknown>) => {
          execCalls.push(sql)
          if (opts?.returnValue === 'resultRows') {
            return [['posts']]
          }
          return undefined
        }),
      }
      const handle = { db } as SchemaDbHandle
      dropAllTables(handle)

      const dropIdx = execCalls.findIndex((sql) => sql.includes('DROP TABLE'))
      const fkOnIdx = execCalls.indexOf('PRAGMA foreign_keys = ON;')

      expect(fkOnIdx).toBeGreaterThan(dropIdx)
    })
  })
})
