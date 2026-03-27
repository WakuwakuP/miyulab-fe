import { serverIdCache } from 'util/db/sqlite/helpers/cache'
import { ensureServer } from 'util/db/sqlite/helpers/server'
import type { DbExecCompat } from 'util/db/sqlite/helpers/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * DbExecCompat のモックを作成する。
 * exec 呼び出しを記録し、SELECT 時に指定の id を返す。
 */
function createMockDb(selectResult: number): {
  db: DbExecCompat
  calls: { sql: string; opts?: Parameters<DbExecCompat['exec']>[1] }[]
} {
  const calls: { sql: string; opts?: Parameters<DbExecCompat['exec']>[1] }[] =
    []

  const db: DbExecCompat = {
    exec: vi.fn((sql: string, opts?: Parameters<DbExecCompat['exec']>[1]) => {
      calls.push({ opts, sql })
      if (opts?.returnValue === 'resultRows') {
        return [[selectResult]]
      }
      return undefined
    }),
  }

  return { calls, db }
}

describe('ensureServer', () => {
  beforeEach(() => {
    serverIdCache.clear()
  })

  it('サーバーをDBに登録し、IDを返す', () => {
    const { db, calls } = createMockDb(42)

    const id = ensureServer(db, 'example.com')

    expect(id).toBe(42)
    expect(calls).toHaveLength(2)

    // INSERT OR IGNORE
    expect(calls[0].sql).toBe(
      'INSERT OR IGNORE INTO servers (host) VALUES (?);',
    )
    expect(calls[0].opts?.bind).toEqual(['example.com'])

    // SELECT id
    expect(calls[1].sql).toBe('SELECT id FROM servers WHERE host = ?;')
    expect(calls[1].opts?.bind).toEqual(['example.com'])
    expect(calls[1].opts?.returnValue).toBe('resultRows')
  })

  it('既にDBにあるサーバーのIDを返す（INSERT OR IGNORE）', () => {
    const { db, calls } = createMockDb(7)

    const id1 = ensureServer(db, 'mastodon.social')
    // キャッシュをクリアして再度呼ぶことで DB に再アクセスさせる
    serverIdCache.clear()
    const id2 = ensureServer(db, 'mastodon.social')

    expect(id1).toBe(7)
    expect(id2).toBe(7)
    // 2回とも INSERT + SELECT が実行される
    expect(calls).toHaveLength(4)
  })

  it('キャッシュヒット時はDBアクセスをスキップする', () => {
    const { db, calls } = createMockDb(99)

    // 1回目: DB にアクセスしてキャッシュに保存
    const id1 = ensureServer(db, 'misskey.io')
    expect(id1).toBe(99)
    expect(calls).toHaveLength(2)

    // 2回目: キャッシュから返すので DB アクセスなし
    const id2 = ensureServer(db, 'misskey.io')
    expect(id2).toBe(99)
    expect(calls).toHaveLength(2) // 増えていない
  })

  it('キャッシュをクリアするとDBから再取得する', () => {
    const { db, calls } = createMockDb(15)

    ensureServer(db, 'pleroma.example')
    expect(calls).toHaveLength(2)

    // キャッシュクリア
    serverIdCache.clear()

    // 再度呼ぶと DB にアクセスする
    const id = ensureServer(db, 'pleroma.example')
    expect(id).toBe(15)
    expect(calls).toHaveLength(4) // 新たに INSERT + SELECT
  })
})
