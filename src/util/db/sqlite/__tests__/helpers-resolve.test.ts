import { localAccountIdCache } from 'util/db/sqlite/helpers/cache'
import {
  resolveLocalAccountId,
  resolvePostId,
} from 'util/db/sqlite/helpers/resolve'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** db.exec のモックを作成するヘルパー */
function createMockDb(execImpl?: (...args: unknown[]) => unknown) {
  return {
    exec: vi.fn(execImpl ?? (() => [])),
  }
}

beforeEach(() => {
  localAccountIdCache.clear()
})

// ================================================================
// resolvePostId
// ================================================================
describe('resolvePostId', () => {
  it('backendUrl と localId から post_id を解決する', () => {
    const db = createMockDb((sql: unknown) => {
      if (typeof sql === 'string' && sql.includes('local_accounts')) {
        return [[42]]
      }
      if (typeof sql === 'string' && sql.includes('post_backend_ids')) {
        return [[100]]
      }
      return []
    })

    const result = resolvePostId(db, 'https://example.com', '12345')

    expect(result).toBe(100)
    expect(db.exec).toHaveBeenCalledTimes(2)
    // 1回目: local_accounts から id を取得
    expect(db.exec).toHaveBeenNthCalledWith(
      1,
      'SELECT id FROM local_accounts WHERE backend_url = ?;',
      { bind: ['https://example.com'], returnValue: 'resultRows' },
    )
    // 2回目: post_backend_ids から post_id を取得
    expect(db.exec).toHaveBeenNthCalledWith(
      2,
      'SELECT post_id FROM post_backend_ids WHERE local_account_id = ? AND local_id = ?;',
      { bind: [42, '12345'], returnValue: 'resultRows' },
    )
  })

  it('見つからない場合 undefined を返す', () => {
    const db = createMockDb((sql: unknown) => {
      if (typeof sql === 'string' && sql.includes('local_accounts')) {
        return [[42]]
      }
      // post_backend_ids では該当なし
      return []
    })

    const result = resolvePostId(db, 'https://example.com', 'nonexistent')

    expect(result).toBeUndefined()
  })

  it('local_account_id が見つからない場合 undefined を返す', () => {
    const db = createMockDb(() => [])

    const result = resolvePostId(db, 'https://unknown.example.com', '12345')

    expect(result).toBeUndefined()
    // local_accounts の問い合わせのみで終了し、post_backend_ids は問い合わせない
    expect(db.exec).toHaveBeenCalledTimes(1)
  })
})

// ================================================================
// resolveLocalAccountId
// ================================================================
describe('resolveLocalAccountId', () => {
  it('backendUrl から local_account の id を解決する', () => {
    const db = createMockDb(() => [[7]])

    const result = resolveLocalAccountId(db, 'https://example.com')

    expect(result).toBe(7)
    expect(db.exec).toHaveBeenCalledWith(
      'SELECT id FROM local_accounts WHERE backend_url = ?;',
      { bind: ['https://example.com'], returnValue: 'resultRows' },
    )
    // 結果がキャッシュに保存されていること
    expect(localAccountIdCache.get('https://example.com')).toBe(7)
  })

  it('キャッシュヒット時は DB アクセスをスキップする', () => {
    localAccountIdCache.set('https://cached.example.com', 99)
    const db = createMockDb()

    const result = resolveLocalAccountId(db, 'https://cached.example.com')

    expect(result).toBe(99)
    expect(db.exec).not.toHaveBeenCalled()
  })

  it('見つからない場合 null を返す', () => {
    const db = createMockDb(() => [])

    const result = resolveLocalAccountId(db, 'https://nonexistent.example.com')

    expect(result).toBeNull()
    // null もキャッシュに保存されていること
    expect(
      localAccountIdCache.get('https://nonexistent.example.com'),
    ).toBeNull()
  })
})
