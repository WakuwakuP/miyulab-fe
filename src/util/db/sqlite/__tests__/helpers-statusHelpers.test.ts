import type { Entity } from 'megalodon'
import type { DbExecCompat } from 'util/db/sqlite/helpers/types'
import {
  deriveAccountDomain,
  getLastInsertRowId,
  mediaTypeCache,
  resolveMediaTypeId,
  resolvePostIdInternal,
  resolveReplyToPostId,
  resolveRepostOfPostId,
  resolveVisibilityId,
  visibilityCache,
} from 'util/db/sqlite/worker/handlers/statusHelpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mock DB factory ────────────────────────────────────────────

function createMockDb(
  execImpl?: (...args: unknown[]) => unknown,
): DbExecCompat {
  return {
    exec: vi.fn(execImpl ?? (() => [])),
  }
}

// ─── キャッシュクリア ───────────────────────────────────────────

beforeEach(() => {
  visibilityCache.clear()
  mediaTypeCache.clear()
})

// ================================================================
// resolvePostIdInternal
// ================================================================
describe('resolvePostIdInternal', () => {
  it('local_account_id と local_id から post_id を解決する', () => {
    const db = createMockDb(() => [[100]])

    const result = resolvePostIdInternal(db, 42, '12345')

    expect(result).toBe(100)
    expect(db.exec).toHaveBeenCalledWith(
      'SELECT post_id FROM post_backend_ids WHERE local_account_id = ? AND local_id = ?;',
      { bind: [42, '12345'], returnValue: 'resultRows' },
    )
  })

  it('見つからない場合 undefined を返す', () => {
    const db = createMockDb(() => [])

    const result = resolvePostIdInternal(db, 42, 'nonexistent')

    expect(result).toBeUndefined()
  })
})

// ================================================================
// resolveVisibilityId
// ================================================================
describe('resolveVisibilityId', () => {
  it('visibility 名から ID を解決する', () => {
    const db = createMockDb(() => [[1]])

    const result = resolveVisibilityId(db, 'public')

    expect(result).toBe(1)
    expect(db.exec).toHaveBeenCalledWith(
      'SELECT id FROM visibility_types WHERE name = ?;',
      { bind: ['public'], returnValue: 'resultRows' },
    )
  })

  it('キャッシュヒット時は DB にアクセスしない', () => {
    visibilityCache.set('public', 1)
    const db = createMockDb()

    const result = resolveVisibilityId(db, 'public')

    expect(result).toBe(1)
    expect(db.exec).not.toHaveBeenCalled()
  })

  it('未知の visibility は null を返しキャッシュしない', () => {
    const db = createMockDb(() => [])

    expect(resolveVisibilityId(db, 'unsupported')).toBeNull()
    expect(visibilityCache.has('unsupported')).toBe(false)
  })
})

// ================================================================
// resolveMediaTypeId
// ================================================================
describe('resolveMediaTypeId', () => {
  it('media type 名から ID を解決する', () => {
    const db = createMockDb(() => [[1]])

    const result = resolveMediaTypeId(db, 'image')

    expect(result).toBe(1)
    expect(db.exec).toHaveBeenCalledWith(
      'SELECT id FROM media_types WHERE name = ?;',
      { bind: ['image'], returnValue: 'resultRows' },
    )
  })

  it('キャッシュヒット時は DB にアクセスしない', () => {
    mediaTypeCache.set('video', 2)
    const db = createMockDb()

    expect(resolveMediaTypeId(db, 'video')).toBe(2)
    expect(db.exec).not.toHaveBeenCalled()
  })

  it('未知の media type は unknown の ID にフォールバックしてキャッシュする', () => {
    const db = createMockDb((sql) =>
      String(sql).includes("name = 'unknown'") ? [[9]] : [],
    )

    expect(resolveMediaTypeId(db, 'model')).toBe(9)
    expect(mediaTypeCache.get('model')).toBe(9)
  })

  it('unknown の行も存在しない場合は明示的に失敗する', () => {
    const db = createMockDb(() => [])

    expect(() => resolveMediaTypeId(db, 'model')).toThrow(
      "media_types table missing 'unknown' entry (lookup for: model)",
    )
  })

  it('unknown の先頭行が欠けている場合も明示的に失敗する', () => {
    const db = createMockDb((sql) =>
      String(sql).includes('WHERE name = ?') ? [] : [undefined],
    )

    expect(() => resolveMediaTypeId(db, 'model')).toThrow(
      "media_types table missing 'unknown' entry (lookup for: model)",
    )
  })
})

// ================================================================
// resolveReplyToPostId
// ================================================================
describe('resolveReplyToPostId', () => {
  it('返信先の post_id を解決する', () => {
    const db = createMockDb(() => [[200]])

    const result = resolveReplyToPostId(db, '99999', 42)

    expect(result).toBe(200)
    expect(db.exec).toHaveBeenCalledWith(
      'SELECT post_id FROM post_backend_ids WHERE local_account_id = ? AND local_id = ? LIMIT 1;',
      { bind: [42, '99999'], returnValue: 'resultRows' },
    )
  })

  it('返信先 ID が空の場合は DB を参照せず null を返す', () => {
    const db = createMockDb()

    expect(resolveReplyToPostId(db, null, 42)).toBeNull()
    expect(db.exec).not.toHaveBeenCalled()
  })

  it('対応する返信先がない場合は null を返す', () => {
    const db = createMockDb(() => [])

    expect(resolveReplyToPostId(db, 'missing', 42)).toBeNull()
  })
})

// ================================================================
// resolveRepostOfPostId
// ================================================================
describe('resolveRepostOfPostId', () => {
  it('object_uri からリポスト元の post_id を解決する', () => {
    const db = createMockDb(() => [[300]])

    const result = resolveRepostOfPostId(
      db,
      'https://example.com/users/alice/statuses/12345',
    )

    expect(result).toBe(300)
    expect(db.exec).toHaveBeenCalledWith(
      "SELECT id FROM posts WHERE object_uri = ? AND object_uri != '' LIMIT 1;",
      {
        bind: ['https://example.com/users/alice/statuses/12345'],
        returnValue: 'resultRows',
      },
    )
  })

  it('リポスト元 URI が空の場合は DB を参照せず null を返す', () => {
    const db = createMockDb()

    expect(resolveRepostOfPostId(db, null)).toBeNull()
    expect(db.exec).not.toHaveBeenCalled()
  })

  it('対応するリポスト元がない場合は null を返す', () => {
    const db = createMockDb(() => [])

    expect(resolveRepostOfPostId(db, 'https://example.com/missing')).toBeNull()
  })
})

// ================================================================
// deriveAccountDomain
// ================================================================
describe('deriveAccountDomain', () => {
  it('acct からドメインを抽出する', () => {
    const account = {
      acct: 'alice@example.com',
      url: 'https://example.com/@alice',
    } as Entity.Account

    const result = deriveAccountDomain(account)

    expect(result).toBe('example.com')
  })

  it('acct に @ が含まれない場合 URL からホスト名を抽出する', () => {
    const account = {
      acct: 'alice',
      url: 'https://local.example.com/@alice',
    } as Entity.Account

    const result = deriveAccountDomain(account)

    expect(result).toBe('local.example.com')
  })

  it('URL が不正な場合空文字を返す', () => {
    const account = {
      acct: 'alice',
      url: 'not-a-url',
    } as Entity.Account

    const result = deriveAccountDomain(account)

    expect(result).toBe('')
  })
})

// ================================================================
// getLastInsertRowId
// ================================================================
describe('getLastInsertRowId', () => {
  it('last_insert_rowid() を返す', () => {
    const db = createMockDb(() => [[42]])

    const result = getLastInsertRowId(db)

    expect(result).toBe(42)
    expect(db.exec).toHaveBeenCalledWith('SELECT last_insert_rowid();', {
      returnValue: 'resultRows',
    })
  })

  it('SQLite が行を返さない場合は失敗する', () => {
    const db = createMockDb(() => [])

    expect(() => getLastInsertRowId(db)).toThrow(
      'last_insert_rowid() returned no rows',
    )
  })

  it('SQLite の先頭行が欠けている場合も失敗する', () => {
    const db = createMockDb(() => [undefined])

    expect(() => getLastInsertRowId(db)).toThrow(
      'last_insert_rowid() returned no rows',
    )
  })
})
