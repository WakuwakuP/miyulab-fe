import { DatabaseSync } from 'node:sqlite'
import type { DbExecCompat } from 'util/db/sqlite/helpers/types'
import {
  type EmergencyTargetCounts,
  handleEnforceMaxLength,
} from 'util/db/sqlite/worker/workerCleanup'
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest'

function createRealDb(): { db: DbExecCompat; native: DatabaseSync } {
  const native = new DatabaseSync(':memory:')
  native.exec(`
    CREATE TABLE timeline_entries (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id       INTEGER,
      created_at_ms INTEGER NOT NULL
    );
    CREATE TABLE notifications (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      related_post_id INTEGER,
      created_at_ms   INTEGER NOT NULL
    );
    CREATE TABLE posts (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      reblog_of_post_id   INTEGER,
      quote_of_post_id    INTEGER,
      created_at_ms       INTEGER NOT NULL
    );
  `)
  const db: DbExecCompat = {
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

function count(native: DatabaseSync, table: string): number {
  const row = native.prepare(`SELECT COUNT(*) AS c FROM ${table};`).get() as {
    c: number
  }
  return row.c
}

function insertRows(
  native: DatabaseSync,
  table: 'timeline_entries' | 'notifications' | 'posts',
  n: number,
  valueForIndex?: (i: number) => number | null,
): void {
  const refCol =
    table === 'posts'
      ? 'reblog_of_post_id'
      : table === 'notifications'
        ? 'related_post_id'
        : 'post_id'
  const stmt = native.prepare(
    `INSERT INTO ${table} (${refCol}, created_at_ms) VALUES (?, ?);`,
  )
  for (let i = 1; i <= n; i++) {
    stmt.run(valueForIndex ? valueForIndex(i) : null, i)
  }
}

function runEmergency(
  db: DbExecCompat,
  opts: { batchLimit: number; targetRatio: number },
): {
  iterations: number
  targetCounts: EmergencyTargetCounts | undefined
} {
  let targetCounts: EmergencyTargetCounts | undefined
  let iterations = 0
  for (;;) {
    iterations++
    const result = handleEnforceMaxLength(db, 0, 0, 0, {
      batchLimit: opts.batchLimit,
      mode: 'emergency',
      targetCounts,
      targetRatio: opts.targetRatio,
    })
    targetCounts = targetCounts ?? result.targetCounts
    if (!result.hasMore) break
    if (iterations > 100) {
      throw new Error('emergency cleanup did not terminate in 100 batches')
    }
  }
  return { iterations, targetCounts }
}

describe('handleEnforceMaxLength — emergency targetCounts', () => {
  let db: DbExecCompat
  let native: DatabaseSync

  beforeEach(() => {
    const real = createRealDb()
    db = real.db
    native = real.native
    onTestFinished(() => {
      native.close()
    })
  })

  it('初期 8 件 / ratio 0.5 / batchLimit 2 → 有限ループで最終 4/4/4', () => {
    insertRows(native, 'timeline_entries', 8)
    insertRows(native, 'notifications', 8)
    insertRows(native, 'posts', 8)

    const { iterations, targetCounts } = runEmergency(db, {
      batchLimit: 2,
      targetRatio: 0.5,
    })

    expect(iterations).toBeGreaterThan(1)
    expect(targetCounts).toEqual({
      notifications: 4,
      posts: 4,
      timeline_entries: 4,
    })
    expect(count(native, 'timeline_entries')).toBe(4)
    expect(count(native, 'notifications')).toBe(4)
    expect(count(native, 'posts')).toBe(4)
  })

  it('実行中の追加分で固定目標が縮まない', () => {
    insertRows(native, 'timeline_entries', 8)
    insertRows(native, 'notifications', 8)
    insertRows(native, 'posts', 8)

    const first = handleEnforceMaxLength(db, 0, 0, 0, {
      batchLimit: 2,
      mode: 'emergency',
      targetRatio: 0.5,
    })
    const targetCounts = first.targetCounts
    expect(targetCounts).toEqual({
      notifications: 4,
      posts: 4,
      timeline_entries: 4,
    })

    insertRows(native, 'timeline_entries', 3)

    let result = first
    let iterations = 1
    while (result.hasMore) {
      iterations++
      result = handleEnforceMaxLength(db, 0, 0, 0, {
        batchLimit: 2,
        mode: 'emergency',
        targetCounts,
        targetRatio: 0.5,
      })
      if (iterations > 100) throw new Error('did not terminate')
    }

    expect(count(native, 'timeline_entries')).toBe(4)
    expect(count(native, 'notifications')).toBe(4)
    expect(count(native, 'posts')).toBe(4)
  })

  it('全 posts が参照されている場合、目標未達でも削除せず有限停止する', () => {
    insertRows(native, 'timeline_entries', 8)
    insertRows(native, 'notifications', 8)
    insertRows(native, 'posts', 8, (i) => (i % 8) + 1)

    const { iterations, targetCounts } = runEmergency(db, {
      batchLimit: 2,
      targetRatio: 0.5,
    })

    expect(targetCounts).toEqual({
      notifications: 4,
      posts: 4,
      timeline_entries: 4,
    })
    expect(count(native, 'posts')).toBe(8)
    expect(count(native, 'timeline_entries')).toBe(4)
    expect(count(native, 'notifications')).toBe(4)
    expect(iterations).toBeGreaterThan(1)
  })

  it('default batchLimit (2000) で分割されても baseline/2 を下回らない', () => {
    native.exec(`
      WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 4500)
      INSERT INTO timeline_entries (post_id, created_at_ms) SELECT NULL, x FROM c;
      WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 4100)
      INSERT INTO notifications (related_post_id, created_at_ms) SELECT NULL, x FROM c;
      WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 4100)
      INSERT INTO posts (reblog_of_post_id, created_at_ms) SELECT NULL, x FROM c;
    `)

    let targetCounts: EmergencyTargetCounts | undefined
    let iterations = 0
    for (;;) {
      iterations++
      const result = handleEnforceMaxLength(db, 0, 0, 0, {
        mode: 'emergency',
        targetCounts,
        targetRatio: 0.5,
      })
      targetCounts = targetCounts ?? result.targetCounts
      if (!result.hasMore) break
      if (iterations > 100) throw new Error('did not terminate')
    }

    expect(iterations).toBeGreaterThan(1)
    expect(count(native, 'timeline_entries')).toBe(Math.floor(4500 * 0.5))
    expect(count(native, 'notifications')).toBe(Math.floor(4100 * 0.5))
    expect(count(native, 'posts')).toBe(Math.floor(4100 * 0.5))
  })

  it('無効な targetCounts はどのテーブルも変更せず拒否される', () => {
    insertRows(native, 'timeline_entries', 8)
    insertRows(native, 'notifications', 8)
    insertRows(native, 'posts', 8)

    const invalidTargets = [
      { notifications: 4, posts: 4 },
      { notifications: 4, posts: 4, timeline_entries: -1 },
      { notifications: 4, posts: 4, timeline_entries: 1.5 },
      { notifications: 4, posts: 4, timeline_entries: Number.NaN },
      { notifications: 4, posts: 4, timeline_entries: '4' },
      { notifications: 4, posts: 4, timeline_entries: null },
      'not-an-object',
      42,
    ] as const

    for (const targetCounts of invalidTargets) {
      expect(() =>
        handleEnforceMaxLength(db, 0, 0, 0, {
          batchLimit: 2,
          mode: 'emergency',
          targetCounts: targetCounts as unknown as EmergencyTargetCounts,
          targetRatio: 0.5,
        }),
      ).toThrow()
    }

    expect(count(native, 'timeline_entries')).toBe(8)
    expect(count(native, 'notifications')).toBe(8)
    expect(count(native, 'posts')).toBe(8)
  })
})
