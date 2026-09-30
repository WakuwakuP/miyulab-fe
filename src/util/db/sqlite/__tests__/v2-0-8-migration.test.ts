import { DatabaseSync } from 'node:sqlite'
import { v2_0_8_migration } from 'util/db/sqlite/migrations/v2.0.8'
import { createFreshSchema } from 'util/db/sqlite/schema'
import type { SchemaDbHandle } from 'util/db/sqlite/worker/workerSchema'
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest'

const EXPECTED_INDEXES = [
  'idx_notifications_created_at',
  'idx_timeline_entries_created_at',
  'idx_timeline_entries_display_post',
] as const

function createRealDb(): {
  db: SchemaDbHandle['db']
  native: DatabaseSync
} {
  const native = new DatabaseSync(':memory:')
  const db = {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ): unknown => {
      if (opts?.returnValue === 'resultRows') {
        const stmt = native.prepare(sql)
        const rows = (
          opts.bind ? stmt.all(...opts.bind) : stmt.all()
        ) as Record<string, unknown>[]
        return rows.map((row) => Object.values(row))
      }
      if (opts?.bind) {
        return native.prepare(sql).run(...opts.bind)
      }
      return native.exec(sql)
    },
  }
  return { db, native }
}

function explain(native: DatabaseSync, sql: string, bind: unknown[] = []) {
  const rows = native
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...(bind as (number | string | null)[])) as { detail: string }[]
  return rows.map((r) => String(r.detail)).join('\n')
}

describe('v2.0.8 スキーマ / マイグレーション (実 SQLite)', () => {
  let db: SchemaDbHandle['db']
  let native: DatabaseSync

  beforeEach(() => {
    const real = createRealDb()
    db = real.db
    native = real.native
    onTestFinished(() => {
      native.close()
    })
  })

  it('バージョンが {major: 2, minor: 0, patch: 8} である', () => {
    expect(v2_0_8_migration.version).toEqual({
      major: 2,
      minor: 0,
      patch: 8,
    })
  })

  it('フレッシュスキーマに 3 つのインデックスが含まれる', () => {
    createFreshSchema({ db })

    for (const name of EXPECTED_INDEXES) {
      const rows = native
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name = ?;",
        )
        .all(name)
      expect(rows.length, `${name} が sqlite_master に無い`).toBe(1)
    }
  })

  it('v2.0.7 状態からのマイグレーションで同じインデックスが作成される', () => {
    createFreshSchema({ db })
    for (const name of EXPECTED_INDEXES) {
      native.exec(`DROP INDEX IF EXISTS ${name};`)
    }

    v2_0_8_migration.up({ db })
    expect(v2_0_8_migration.validate?.({ db })).toBe(true)
  })

  it('up() は冪等 (2 回適用しても失敗しない)', () => {
    createFreshSchema({ db })
    v2_0_8_migration.up({ db })
    expect(() => v2_0_8_migration.up({ db })).not.toThrow()
    expect(v2_0_8_migration.validate?.({ db })).toBe(true)
  })

  it('validate() はいずれかのインデックスが欠けていれば false を返す', () => {
    createFreshSchema({ db })
    native.exec('DROP INDEX idx_notifications_created_at;')
    expect(v2_0_8_migration.validate?.({ db })).toBe(false)
  })

  it('timeline_entries の created_at_ms ORDER BY で TEMP B-TREE を使わない', () => {
    createFreshSchema({ db })

    const plan = explain(
      native,
      'SELECT id FROM timeline_entries ORDER BY created_at_ms ASC LIMIT ?',
      [2],
    )
    expect(plan).not.toContain('TEMP B-TREE')
    expect(plan).toContain('idx_timeline_entries_created_at')
  })

  it('notifications の created_at_ms ORDER BY で TEMP B-TREE を使わない', () => {
    createFreshSchema({ db })

    const plan = explain(
      native,
      'SELECT id FROM notifications ORDER BY created_at_ms ASC LIMIT ?',
      [2],
    )
    expect(plan).not.toContain('TEMP B-TREE')
    expect(plan).toContain('idx_notifications_created_at')
  })

  it('timeline_entries の display_post_id 参照で idx_timeline_entries_display_post を使う', () => {
    createFreshSchema({ db })

    const plan = explain(
      native,
      'SELECT rowid FROM timeline_entries WHERE display_post_id = ?',
      [1],
    )
    expect(plan).toContain('idx_timeline_entries_display_post')
  })

  it('posts 削除時の FK 参照で timeline_entries を SCAN しない', () => {
    createFreshSchema({ db })
    native.exec('PRAGMA foreign_keys = ON;')

    const plan = explain(native, 'DELETE FROM posts WHERE id = ?', [1])
    expect(plan).not.toContain('SCAN timeline_entries')
  })

  it('object_uri の非空条件付き検索で部分インデックス idx_posts_object_uri を使う', () => {
    createFreshSchema({ db })

    const plan = explain(
      native,
      "SELECT id, is_reblog FROM posts WHERE object_uri = ? AND object_uri != ''",
      ['https://example.com/status/1'],
    )
    expect(plan).toContain('idx_posts_object_uri')
    expect(plan).not.toContain('SCAN posts')
  })

  it('空の object_uri はマッチ対象にならない', () => {
    createFreshSchema({ db })
    native.exec('PRAGMA foreign_keys = OFF;')
    native.exec(
      `INSERT INTO posts (object_uri, origin_server_id, author_profile_id, created_at_ms, visibility_id)
       VALUES ('', 0, 0, 1, 0), ('https://example.com/a', 0, 0, 2, 0);`,
    )

    const empty = native
      .prepare(
        "SELECT id FROM posts WHERE object_uri = ? AND object_uri != '';",
      )
      .all('')
    expect(empty).toEqual([])

    const hit = native
      .prepare(
        "SELECT id, is_reblog FROM posts WHERE object_uri = ? AND object_uri != '';",
      )
      .all('https://example.com/a') as { id: number }[]
    expect(hit).toHaveLength(1)
  })

  it('timeline_entries.display_post_id は ON DELETE SET NULL', () => {
    createFreshSchema({ db })
    native.exec('PRAGMA foreign_keys = OFF;')
    native.exec(
      `INSERT INTO posts (object_uri, origin_server_id, author_profile_id, created_at_ms, visibility_id)
       VALUES ('p1', 0, 0, 1, 0), ('p2', 0, 0, 2, 0);`,
    )
    native.exec(
      `INSERT INTO timeline_entries (local_account_id, timeline_key, post_id, display_post_id, created_at_ms)
       VALUES (0, 'home', 1, 2, 1);`,
    )
    native.exec('PRAGMA foreign_keys = ON;')

    native.exec('DELETE FROM posts WHERE id = 2;')
    const row = native
      .prepare('SELECT post_id, display_post_id FROM timeline_entries;')
      .get() as { post_id: number; display_post_id: number | null }
    expect(row.post_id).toBe(1)
    expect(row.display_post_id).toBeNull()
  })

  it('timeline_entries.post_id は ON DELETE CASCADE', () => {
    createFreshSchema({ db })
    native.exec('PRAGMA foreign_keys = OFF;')
    native.exec(
      `INSERT INTO posts (object_uri, origin_server_id, author_profile_id, created_at_ms, visibility_id)
       VALUES ('p1', 0, 0, 1, 0);`,
    )
    native.exec(
      `INSERT INTO timeline_entries (local_account_id, timeline_key, post_id, display_post_id, created_at_ms)
       VALUES (0, 'home', 1, 1, 1);`,
    )
    native.exec('PRAGMA foreign_keys = ON;')

    native.exec('DELETE FROM posts WHERE id = 1;')
    const rows = native.prepare('SELECT id FROM timeline_entries;').all()
    expect(rows).toEqual([])
  })

  it('notifications.related_post_id は ON DELETE SET NULL', () => {
    createFreshSchema({ db })
    native.exec('PRAGMA foreign_keys = OFF;')
    native.exec(
      `INSERT INTO posts (object_uri, origin_server_id, author_profile_id, created_at_ms, visibility_id)
       VALUES ('p1', 0, 0, 1, 0);`,
    )
    native.exec(
      `INSERT INTO notifications (local_account_id, local_id, notification_type_id, created_at_ms, related_post_id)
       VALUES (0, 'n1', 0, 1, 1);`,
    )
    native.exec('PRAGMA foreign_keys = ON;')

    native.exec('DELETE FROM posts WHERE id = 1;')
    const row = native
      .prepare('SELECT related_post_id FROM notifications;')
      .get() as { related_post_id: number | null }
    expect(row.related_post_id).toBeNull()
  })
})
