import {
  migrations,
  runMigrations,
  stampSchemaVersion,
} from 'util/db/sqlite/migrations'
import {
  addColumnIfNotExists,
  createIndexSafe,
  recreateTable,
  tableExists,
} from 'util/db/sqlite/migrations/helpers'
import type { Migration } from 'util/db/sqlite/migrations/types'
import { encodeSemVer, LATEST_VERSION } from 'util/db/sqlite/schema/version'
import type { SchemaDbHandle } from 'util/db/sqlite/worker/workerSchema'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mock DB factory ────────────────────────────────────────────
function createMockDb(userVersion: number) {
  const execCalls: string[] = []
  const db = {
    exec: vi.fn((sql: string, opts?: Record<string, unknown>) => {
      execCalls.push(sql)
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
  return { db, execCalls, handle: { db } as SchemaDbHandle }
}

describe('runMigrations', () => {
  const dropAllTables = vi.fn()
  const createFreshSchema = vi.fn()

  beforeEach(() => {
    vi.restoreAllMocks()
    dropAllTables.mockReset()
    createFreshSchema.mockReset()
    // 共有 migrations 配列をクリア
    migrations.length = 0
  })

  describe('新規DB (user_version = 0)', () => {
    it('createFreshSchema を呼び出す', () => {
      const { handle } = createMockDb(0)
      runMigrations(handle, dropAllTables, createFreshSchema)
      expect(createFreshSchema).toHaveBeenCalledWith(handle)
    })

    it('user_version を LATEST_VERSION のエンコード値に設定する', () => {
      const { handle, execCalls } = createMockDb(0)
      runMigrations(handle, dropAllTables, createFreshSchema)
      const latestEncoded = encodeSemVer(LATEST_VERSION)
      expect(execCalls).toContain(`PRAGMA user_version = ${latestEncoded};`)
    })

    it('dropAllTables を呼び出さない', () => {
      const { handle } = createMockDb(0)
      runMigrations(handle, dropAllTables, createFreshSchema)
      expect(dropAllTables).not.toHaveBeenCalled()
    })

    it('createFreshSchema が失敗したらロールバックして例外を投げる', () => {
      const { handle, execCalls } = createMockDb(0)
      createFreshSchema.mockImplementation(() => {
        throw new Error('schema error')
      })
      expect(() =>
        runMigrations(handle, dropAllTables, createFreshSchema),
      ).toThrow('schema error')
      expect(execCalls).toContain('ROLLBACK;')
    })
  })

  describe('最新バージョン (user_version = latestEncoded)', () => {
    it('何もしない（PRAGMA 読取りのみ）', () => {
      const latestEncoded = encodeSemVer(LATEST_VERSION)
      const { handle, db } = createMockDb(latestEncoded)
      runMigrations(handle, dropAllTables, createFreshSchema)
      expect(db.exec).toHaveBeenCalledTimes(1)
      expect(createFreshSchema).not.toHaveBeenCalled()
      expect(dropAllTables).not.toHaveBeenCalled()
    })
  })

  describe('レガシーバージョン (user_version = 28)', () => {
    it('1.0.0 に正規化して適用可能なマイグレーションを見つける', () => {
      const migration: Migration = {
        description: 'test migration',
        up: vi.fn(),
        version: { major: 2, minor: 0, patch: 0 },
      }
      migrations.push(migration)

      const { handle } = createMockDb(28)
      runMigrations(handle, dropAllTables, createFreshSchema)
      expect(migration.up).toHaveBeenCalledWith(handle)
    })

    it('マイグレーションをバージョン順に適用する', () => {
      const order: string[] = []
      const m1: Migration = {
        description: 'first',
        up: vi.fn(() => order.push('m1')),
        version: { major: 1, minor: 1, patch: 0 },
      }
      const m2: Migration = {
        description: 'second',
        up: vi.fn(() => order.push('m2')),
        version: { major: 2, minor: 0, patch: 0 },
      }
      // 逆順に追加してソートを検証
      migrations.push(m2, m1)

      const { handle } = createMockDb(28)
      runMigrations(handle, dropAllTables, createFreshSchema)
      expect(order).toEqual(['m1', 'm2'])
    })

    it('各マイグレーション後に user_version を設定する', () => {
      const m1: Migration = {
        description: 'v2',
        up: vi.fn(),
        version: { major: 2, minor: 0, patch: 0 },
      }
      migrations.push(m1)

      const { handle, execCalls } = createMockDb(28)
      runMigrations(handle, dropAllTables, createFreshSchema)
      expect(execCalls).toContain(
        `PRAGMA user_version = ${encodeSemVer(m1.version)};`,
      )
    })

    it('各マイグレーションで stampSchemaVersion を呼び出す', () => {
      const m1: Migration = {
        description: 'v2 migration',
        up: vi.fn(),
        version: { major: 2, minor: 0, patch: 0 },
      }
      migrations.push(m1)

      const { handle, execCalls } = createMockDb(28)
      runMigrations(handle, dropAllTables, createFreshSchema)
      const stampCall = execCalls.find((sql) => sql.includes('schema_version'))
      expect(stampCall).toBeDefined()
      expect(stampCall).toContain('2.0.0')
    })
  })

  describe('マイグレーション失敗', () => {
    it('失敗したマイグレーションをロールバックする', () => {
      const m1: Migration = {
        description: 'failing',
        up: vi.fn(() => {
          throw new Error('up failed')
        }),
        version: { major: 2, minor: 0, patch: 0 },
      }
      migrations.push(m1)

      const { handle, execCalls } = createMockDb(28)
      runMigrations(handle, dropAllTables, createFreshSchema)
      expect(execCalls).toContain('ROLLBACK;')
    })

    it('resetSchema にフォールバックする（DROP + 再作成）', () => {
      const m1: Migration = {
        description: 'failing',
        up: vi.fn(() => {
          throw new Error('up failed')
        }),
        version: { major: 2, minor: 0, patch: 0 },
      }
      migrations.push(m1)

      const { handle } = createMockDb(28)
      runMigrations(handle, dropAllTables, createFreshSchema)
      expect(dropAllTables).toHaveBeenCalled()
      expect(createFreshSchema).toHaveBeenCalled()
    })
  })

  describe('バージョンギャップ（適用可能なマイグレーションなし）', () => {
    it('マイグレーションが見つからない場合 resetSchema を呼び出す', () => {
      const { handle } = createMockDb(28)
      runMigrations(handle, dropAllTables, createFreshSchema)
      expect(dropAllTables).toHaveBeenCalled()
      expect(createFreshSchema).toHaveBeenCalled()
    })

    it('ダウングレード（current > latest）時に resetSchema を呼び出す', () => {
      const futureEncoded = encodeSemVer({ major: 99, minor: 0, patch: 0 })
      const { handle } = createMockDb(futureEncoded)
      runMigrations(handle, dropAllTables, createFreshSchema)
      expect(dropAllTables).toHaveBeenCalled()
      expect(createFreshSchema).toHaveBeenCalled()
    })
  })
})

describe('stampSchemaVersion', () => {
  it('schema_version テーブルにバージョンレコードを挿入する', () => {
    const db = { exec: vi.fn() }
    stampSchemaVersion(db, { major: 2, minor: 0, patch: 0 }, 'test migration')
    expect(db.exec).toHaveBeenCalledTimes(1)
    const sql = db.exec.mock.calls[0][0] as string
    expect(sql).toContain('schema_version')
    expect(sql).toContain('2.0.0')
    expect(sql).toContain('test migration')
  })

  it('schema_version テーブルが存在しない場合はエラーを無視する', () => {
    const db = {
      exec: vi.fn(() => {
        throw new Error('no such table: schema_version')
      }),
    }
    expect(() =>
      stampSchemaVersion(db, { major: 2, minor: 0, patch: 0 }, 'test'),
    ).not.toThrow()
  })
})

describe('マイグレーションヘルパー', () => {
  describe('tableExists', () => {
    it('テーブルが存在する場合 true を返す', () => {
      const db = {
        exec: vi.fn(() => [[1]]),
      }
      expect(tableExists(db, 'posts')).toBe(true)
    })

    it('テーブルが存在しない場合 false を返す', () => {
      const db = {
        exec: vi.fn(() => [[0]]),
      }
      expect(tableExists(db, 'nonexistent')).toBe(false)
    })
  })

  describe('addColumnIfNotExists', () => {
    it('カラムが存在しない場合に追加する', () => {
      const db = {
        exec: vi.fn((sql: string) => {
          if (sql.includes('PRAGMA table_info')) {
            return [
              [0, 'id', 'INTEGER', 0, null, 1],
              [1, 'name', 'TEXT', 0, null, 0],
            ]
          }
          return undefined
        }),
      }
      addColumnIfNotExists(db, 'posts', 'new_col', 'TEXT NOT NULL DEFAULT ""')
      expect(db.exec).toHaveBeenCalledTimes(2)
      const alterCall = db.exec.mock.calls[1][0] as string
      expect(alterCall).toContain('ALTER TABLE posts ADD COLUMN new_col')
    })

    it('カラムが既に存在する場合は何もしない', () => {
      const db = {
        exec: vi.fn(() => [
          [0, 'id', 'INTEGER', 0, null, 1],
          [1, 'existing_col', 'TEXT', 0, null, 0],
        ]),
      }
      addColumnIfNotExists(db, 'posts', 'existing_col', 'TEXT')
      expect(db.exec).toHaveBeenCalledTimes(1)
    })
  })

  describe('recreateTable', () => {
    it('バックアップ方式でテーブルを再作成できる', () => {
      const calls: string[] = []
      const db = {
        exec: vi.fn((sql: string) => {
          calls.push(sql)
        }),
      }
      recreateTable(
        db,
        'posts',
        'CREATE TABLE "posts" (id INTEGER, name TEXT)',
        'id, name',
      )
      // 1. 旧テーブルをバックアップにリネーム
      expect(calls[0]).toContain(
        'ALTER TABLE "posts" RENAME TO "_posts_v1_backup"',
      )
      // 2. newCreateSql で新テーブル作成
      expect(calls[1]).toContain('CREATE TABLE "posts"')
      // 3. バックアップからデータをコピー
      expect(calls[2]).toContain('INSERT INTO "posts" (id, name)')
      expect(calls[2]).toContain('SELECT id, name FROM "_posts_v1_backup"')
      // 4. バックアップを削除
      expect(calls[3]).toContain('DROP TABLE "_posts_v1_backup"')
    })

    it('selectExpr でカラムマッピングをカスタマイズできる', () => {
      const calls: string[] = []
      const db = {
        exec: vi.fn((sql: string) => {
          calls.push(sql)
        }),
      }
      recreateTable(
        db,
        'posts',
        'CREATE TABLE "posts" (id INTEGER, name TEXT)',
        'id, name',
        'id, upper(name) as name',
      )
      // INSERT の SELECT 部分が selectExpr になる
      expect(calls[2]).toContain(
        'SELECT id, upper(name) as name FROM "_posts_v1_backup"',
      )
    })

    it('postSql でインデックスを作成できる', () => {
      const calls: string[] = []
      const db = {
        exec: vi.fn((sql: string) => {
          calls.push(sql)
        }),
      }
      recreateTable(
        db,
        'posts',
        'CREATE TABLE "posts" (id INTEGER, name TEXT)',
        'id, name',
        undefined,
        {
          postSql: [
            'CREATE INDEX idx_posts_name ON posts(name);',
            'CREATE INDEX idx_posts_id ON posts(id);',
          ],
        },
      )
      // postSql はバックアップ削除後に実行される
      expect(calls[4]).toBe('CREATE INDEX idx_posts_name ON posts(name);')
      expect(calls[5]).toBe('CREATE INDEX idx_posts_id ON posts(id);')
    })

    it('preSql で前処理を実行できる', () => {
      const calls: string[] = []
      const db = {
        exec: vi.fn((sql: string) => {
          calls.push(sql)
        }),
      }
      recreateTable(
        db,
        'posts',
        'CREATE TABLE "posts" (id INTEGER, name TEXT)',
        'id, name',
        undefined,
        {
          preSql: [
            'PRAGMA foreign_keys = OFF;',
            'DROP INDEX IF EXISTS idx_old;',
          ],
        },
      )
      // preSql はリネーム前に実行される
      expect(calls[0]).toBe('PRAGMA foreign_keys = OFF;')
      expect(calls[1]).toBe('DROP INDEX IF EXISTS idx_old;')
      // リネームは preSql の後
      expect(calls[2]).toContain(
        'ALTER TABLE "posts" RENAME TO "_posts_v1_backup"',
      )
    })
  })

  describe('createIndexSafe', () => {
    it('CREATE INDEX IF NOT EXISTS を実行する', () => {
      const db = { exec: vi.fn() }
      createIndexSafe(db, 'CREATE INDEX idx_test ON posts(id)')
      const sql = db.exec.mock.calls[0][0] as string
      expect(sql).toContain('IF NOT EXISTS')
    })

    it('IF NOT EXISTS を重複させない', () => {
      const db = { exec: vi.fn() }
      createIndexSafe(db, 'CREATE INDEX IF NOT EXISTS idx_test ON posts(id)')
      const sql = db.exec.mock.calls[0][0] as string
      const matches = sql.match(/IF NOT EXISTS/g)
      expect(matches).toHaveLength(1)
    })
  })
})
