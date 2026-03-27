import {
  emojiIdCache,
  localAccountIdCache,
  profileIdCache,
  serverIdCache,
} from 'util/db/sqlite/helpers/cache'
import type { DbExecCompat } from 'util/db/sqlite/helpers/types'
import {
  handleBulkUpsertCustomEmojis,
  handleEnsureLocalAccount,
} from 'util/db/sqlite/worker/handlers/accountHandlers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mock DB factory ────────────────────────────────────────────

type ExecCall = { sql: string; opts?: Parameters<DbExecCompat['exec']>[1] }

/**
 * DbExecCompat のモックを作成する。
 * SELECT の returnValue === 'resultRows' のとき、selectResults を順番に返す。
 */
function createMockDb(selectResults: unknown[] = []): {
  db: DbExecCompat
  calls: ExecCall[]
} {
  const calls: ExecCall[] = []
  let selectIndex = 0

  const db: DbExecCompat = {
    exec: vi.fn((sql: string, opts?: Parameters<DbExecCompat['exec']>[1]) => {
      calls.push({ opts, sql })
      if (opts?.returnValue === 'resultRows') {
        const result = selectResults[selectIndex]
        selectIndex++
        return result !== undefined ? [[result]] : []
      }
      return undefined
    }),
  }

  return { calls, db }
}

// ─── handleEnsureLocalAccount ───────────────────────────────────

describe('handleEnsureLocalAccount', () => {
  beforeEach(() => {
    serverIdCache.clear()
    profileIdCache.clear()
    emojiIdCache.clear()
    localAccountIdCache.clear()
  })

  const backendUrl = 'https://mastodon.social'
  const accountJson = JSON.stringify({
    acct: 'testuser@mastodon.social',
    avatar: 'https://mastodon.social/avatar.png',
    avatar_static: 'https://mastodon.social/avatar_static.png',
    bot: false,
    display_name: 'Test User',
    emojis: [],
    header: 'https://mastodon.social/header.png',
    header_static: 'https://mastodon.social/header_static.png',
    id: '12345',
    locked: false,
    note: 'Hello!',
    url: 'https://mastodon.social/@testuser',
    username: 'testuser',
  })

  it('ローカルアカウントを登録する（新規）', () => {
    // ensureServer SELECT → server_id=1, ensureProfile SELECT → profile_id=10
    const { db, calls } = createMockDb([1, 10])

    const result = handleEnsureLocalAccount(db, backendUrl, accountJson)

    expect(result).toEqual({ changedTables: [] })

    // ensureServer: INSERT OR IGNORE + SELECT
    const serverInsert = calls.find(
      (c) => c.sql.includes('INSERT') && c.sql.includes('servers'),
    )
    expect(serverInsert).toBeDefined()
    // host はバックエンドURLからホスト名を抽出したもの
    expect(serverInsert!.opts?.bind).toEqual(['mastodon.social'])

    // ensureProfile: INSERT + SELECT
    const profileInsert = calls.find(
      (c) => c.sql.includes('INSERT') && c.sql.includes('profiles'),
    )
    expect(profileInsert).toBeDefined()

    // local_accounts への UPSERT
    const localAccountUpsert = calls.find(
      (c) => c.sql.includes('INSERT') && c.sql.includes('local_accounts'),
    )
    expect(localAccountUpsert).toBeDefined()
    expect(localAccountUpsert!.sql).toContain('ON CONFLICT')
    expect(localAccountUpsert!.sql).toContain('backend_url')
    expect(localAccountUpsert!.sql).toContain('backend_type')
    expect(localAccountUpsert!.sql).toContain('acct')
    expect(localAccountUpsert!.sql).toContain('remote_account_id')

    // bind にバックエンドURL, アカウント情報が含まれる
    const bind = localAccountUpsert!.opts?.bind as (string | number | null)[]
    expect(bind).toContain(1) // server_id
    expect(bind).toContain('https://mastodon.social') // backend_url
    expect(bind).toContain('testuser@mastodon.social') // acct
    expect(bind).toContain('12345') // remote_account_id

    // ensureProfileAlias は呼ばれない（削除済み）
    const profileAliasCalls = calls.filter((c) =>
      c.sql.includes('profile_aliases'),
    )
    expect(profileAliasCalls).toHaveLength(0)
  })

  it('既存のローカルアカウントを更新する', () => {
    const { db, calls } = createMockDb([1, 10])

    // 2回呼んでも ON CONFLICT で更新される
    handleEnsureLocalAccount(db, backendUrl, accountJson)

    const localAccountUpsert = calls.find(
      (c) => c.sql.includes('INSERT') && c.sql.includes('local_accounts'),
    )
    expect(localAccountUpsert).toBeDefined()
    expect(localAccountUpsert!.sql).toContain('ON CONFLICT')
    expect(localAccountUpsert!.sql).toContain('DO UPDATE SET')
    // updated_at が更新される
    expect(localAccountUpsert!.sql).toContain('updated_at')
  })

  it('profile_id を設定する', () => {
    // ensureServer → 5, ensureProfile → 42
    const { db, calls } = createMockDb([5, 42])

    handleEnsureLocalAccount(db, backendUrl, accountJson)

    const localAccountUpsert = calls.find(
      (c) => c.sql.includes('INSERT') && c.sql.includes('local_accounts'),
    )
    expect(localAccountUpsert).toBeDefined()
    expect(localAccountUpsert!.sql).toContain('profile_id')

    const bind = localAccountUpsert!.opts?.bind as (string | number | null)[]
    expect(bind).toContain(42) // profile_id from ensureProfile
  })

  it('server_id を ensureServer で解決する', () => {
    // ensureServer → 99, ensureProfile → 7
    const { db, calls } = createMockDb([99, 7])

    handleEnsureLocalAccount(db, backendUrl, accountJson)

    // ensureServer が mastodon.social (host) で呼ばれる
    const serverSelect = calls.find(
      (c) =>
        c.sql.includes('SELECT') &&
        c.sql.includes('servers') &&
        c.opts?.returnValue === 'resultRows',
    )
    expect(serverSelect).toBeDefined()
    expect(serverSelect!.opts?.bind).toEqual(['mastodon.social'])

    // local_accounts の bind に server_id が含まれる
    const localAccountUpsert = calls.find(
      (c) => c.sql.includes('INSERT') && c.sql.includes('local_accounts'),
    )
    const bind = localAccountUpsert!.opts?.bind as (string | number | null)[]
    expect(bind).toContain(99) // server_id
  })
})

// ─── handleBulkUpsertCustomEmojis ───────────────────────────────

describe('handleBulkUpsertCustomEmojis', () => {
  beforeEach(() => {
    serverIdCache.clear()
    emojiIdCache.clear()
  })

  const backendUrl = 'https://misskey.io'

  it('カスタム絵文字を一括登録する', () => {
    const emojisJson = JSON.stringify([
      {
        shortcode: 'blobcat',
        static_url: 'https://misskey.io/emoji/blobcat_static.png',
        url: 'https://misskey.io/emoji/blobcat.png',
        visible_in_picker: true,
      },
      {
        shortcode: 'blobfox',
        static_url: null,
        url: 'https://misskey.io/emoji/blobfox.png',
        visible_in_picker: false,
      },
    ])

    // ensureServer SELECT → 3, ensureCustomEmoji SELECT × 2 → 100, 200
    const { db, calls } = createMockDb([3, 100, 200])

    const result = handleBulkUpsertCustomEmojis(db, backendUrl, emojisJson)

    expect(result).toEqual({ changedTables: [] })

    // BEGIN + COMMIT が呼ばれる
    expect(calls[0].sql).toBe('BEGIN;')
    expect(calls[calls.length - 1].sql).toBe('COMMIT;')

    // ensureCustomEmoji で custom_emojis に INSERT される
    const emojiInserts = calls.filter(
      (c) => c.sql.includes('INSERT') && c.sql.includes('custom_emojis'),
    )
    expect(emojiInserts).toHaveLength(2)

    // 1つ目の絵文字
    expect(emojiInserts[0].opts?.bind).toEqual([
      3,
      'blobcat',
      'https://misskey.io/emoji/blobcat.png',
      'https://misskey.io/emoji/blobcat_static.png',
      1,
    ])

    // 2つ目の絵文字
    expect(emojiInserts[1].opts?.bind).toEqual([
      3,
      'blobfox',
      'https://misskey.io/emoji/blobfox.png',
      null,
      0,
    ])
  })

  it('server_id をホスト名で解決する', () => {
    const emojisJson = JSON.stringify([
      { shortcode: 'test', url: 'https://misskey.io/emoji/test.png' },
    ])

    // ensureServer SELECT → 7, ensureCustomEmoji SELECT → 50
    const { db, calls } = createMockDb([7, 50])

    handleBulkUpsertCustomEmojis(db, backendUrl, emojisJson)

    // ensureServer に host (misskey.io) が渡される（backendUrl ではない）
    const serverInsert = calls.find(
      (c) => c.sql.includes('INSERT') && c.sql.includes('servers'),
    )
    expect(serverInsert).toBeDefined()
    expect(serverInsert!.opts?.bind).toEqual(['misskey.io'])

    const serverSelect = calls.find(
      (c) =>
        c.sql.includes('SELECT') &&
        c.sql.includes('servers') &&
        c.opts?.returnValue === 'resultRows',
    )
    expect(serverSelect).toBeDefined()
    expect(serverSelect!.opts?.bind).toEqual(['misskey.io'])
  })

  it('空の絵文字リストの場合は何もしない', () => {
    const emojisJson = JSON.stringify([])
    const { db, calls } = createMockDb()

    const result = handleBulkUpsertCustomEmojis(db, backendUrl, emojisJson)

    expect(result).toEqual({ changedTables: [] })
    // BEGIN すら呼ばれない
    expect(calls).toHaveLength(0)
  })

  it('エラー時にROLLBACKする', () => {
    const emojisJson = JSON.stringify([
      { shortcode: 'fail', url: 'https://misskey.io/emoji/fail.png' },
    ])

    const calls: ExecCall[] = []
    const db: DbExecCompat = {
      exec: vi.fn((sql: string, opts?: Parameters<DbExecCompat['exec']>[1]) => {
        calls.push({ opts, sql })
        // ensureServer の SELECT で正常に返す
        if (opts?.returnValue === 'resultRows' && sql.includes('servers')) {
          return [[1]]
        }
        // ensureCustomEmoji の INSERT で例外を投げる
        if (sql.includes('INSERT') && sql.includes('custom_emojis')) {
          throw new Error('DB error')
        }
        return undefined
      }),
    }

    expect(() =>
      handleBulkUpsertCustomEmojis(db, backendUrl, emojisJson),
    ).toThrow('DB error')

    // ROLLBACK が呼ばれる
    const rollbackCall = calls.find((c) => c.sql === 'ROLLBACK;')
    expect(rollbackCall).toBeDefined()
  })
})
