import type { Entity } from 'megalodon'
import {
  emojiIdCache,
  profileIdCache,
  serverHostCache,
} from 'util/db/sqlite/helpers/cache'
import {
  computeCanonicalAcct,
  ensureProfile,
  syncProfileCustomEmojis,
  syncProfileFields,
  syncProfileStats,
} from 'util/db/sqlite/helpers/profile'
import type { DbExecCompat } from 'util/db/sqlite/helpers/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mock DB factory ────────────────────────────────────────────

/**
 * DbExecCompat のモックを作成する。
 * exec 呼び出しを記録し、SELECT 時に指定の結果を返す。
 */
function createMockDb(selectResult?: unknown[][]): {
  db: DbExecCompat
  calls: { sql: string; opts?: Parameters<DbExecCompat['exec']>[1] }[]
} {
  const calls: { sql: string; opts?: Parameters<DbExecCompat['exec']>[1] }[] =
    []

  const db: DbExecCompat = {
    exec: vi.fn((sql: string, opts?: Parameters<DbExecCompat['exec']>[1]) => {
      calls.push({ opts, sql })
      if (opts?.returnValue === 'resultRows') {
        return selectResult ?? []
      }
      return undefined
    }),
  }

  return { calls, db }
}

// ─── ensureCustomEmoji モック ───────────────────────────────────

let ensureCustomEmojiCounter = 0
vi.mock('util/db/sqlite/helpers/emoji', () => ({
  ensureCustomEmoji: vi.fn(
    (_db: DbExecCompat, _serverId: number, _emoji: unknown) => {
      return ++ensureCustomEmojiCounter
    },
  ),
}))

// ─── Mock Account factory ───────────────────────────────────────

function createMockAccount(
  overrides: Partial<Entity.Account> = {},
): Entity.Account {
  return {
    acct: 'test@example.com',
    avatar: '',
    avatar_static: '',
    bot: false,
    created_at: '2024-01-01T00:00:00.000Z',
    display_name: '',
    emojis: [],
    fields: [],
    followers_count: 0,
    following_count: 0,
    group: null,
    header: '',
    header_static: '',
    id: '1',
    limited: null,
    locked: false,
    moved: null,
    noindex: null,
    note: '',
    statuses_count: 0,
    suspended: null,
    url: '',
    username: 'test',
    ...overrides,
  }
}

// ─── computeCanonicalAcct ────────────────────────────────────────

describe('computeCanonicalAcct', () => {
  it('FQN 形式 (acct に @ あり) はそのまま返す', () => {
    expect(computeCanonicalAcct('alice@example.com', 'other.host')).toBe(
      'alice@example.com',
    )
  })

  it('ローカル形式 (@ なし) は acct@host に正規化する', () => {
    expect(computeCanonicalAcct('localuser', 'myserver.com')).toBe(
      'localuser@myserver.com',
    )
  })
})

// ─── ensureProfile ──────────────────────────────────────────────

describe('ensureProfile', () => {
  beforeEach(() => {
    profileIdCache.clear()
    serverHostCache.clear()
    // テスト用サーバーホスト
    serverHostCache.set(1, 'example.com')
    serverHostCache.set(3, 'myserver.com')
    serverHostCache.set(42, 'remote.example.com')
  })

  it('プロフィールをDBに登録し、IDを返す', () => {
    const { db, calls } = createMockDb([[42]])

    const account = createMockAccount({
      acct: 'alice@example.com',
      avatar: 'https://example.com/avatar.png',
      avatar_static: 'https://example.com/avatar_static.png',
      display_name: 'Alice',
      followers_count: 10,
      following_count: 20,
      header: 'https://example.com/header.png',
      header_static: 'https://example.com/header_static.png',
      note: '<p>Hello world</p>',
      statuses_count: 100,
      url: 'https://example.com/@alice',
      username: 'alice',
    })

    const id = ensureProfile(db, account, 1)

    expect(id).toBe(42)
    // UPSERT + SELECT の 2 回
    expect(calls).toHaveLength(2)

    // 1回目: UPSERT
    expect(calls[0].sql).toContain('INSERT INTO profiles')
    expect(calls[0].sql).toContain('ON CONFLICT(canonical_acct)')
    expect(calls[0].sql).toContain('canonical_acct')
    expect(calls[0].sql).toContain('avatar_static_url')
    expect(calls[0].sql).toContain('header_static_url')
    expect(calls[0].sql).toContain('bio')
    expect(calls[0].sql).toContain('is_locked')
    expect(calls[0].sql).toContain('is_bot')
    expect(calls[0].sql).toContain('last_fetched_at')
    // 旧カラムを使っていないこと
    expect(calls[0].sql).not.toContain('note_html')
    expect(calls[0].sql).not.toContain('"locked"')
    expect(calls[0].sql).not.toContain('"bot"')
    expect(calls[0].sql).not.toContain('"domain"')

    // bind パラメータの確認
    const bind = calls[0].opts?.bind as (string | number | null)[]
    expect(bind[0]).toBe('https://example.com/@alice') // actor_uri
    expect(bind[1]).toBe('alice') // username
    expect(bind[2]).toBe(1) // server_id
    expect(bind[3]).toBe('alice@example.com') // acct
    expect(bind[4]).toBe('alice@example.com') // canonical_acct (FQN なのでそのまま)
    expect(bind[5]).toBe('Alice') // display_name
    expect(bind[8]).toBe('https://example.com/avatar_static.png') // avatar_static_url
    expect(bind[11]).toBe('<p>Hello world</p>') // bio
    expect(bind[12]).toBe(0) // is_locked
    expect(bind[13]).toBe(0) // is_bot

    // 2回目: SELECT id (canonical_acct で検索)
    expect(calls[1].sql).toContain('SELECT id FROM profiles')
    expect(calls[1].sql).not.toContain('profile_id')
    expect(calls[1].sql).toContain('canonical_acct = ?')
    expect(calls[1].opts?.bind).toEqual(['alice@example.com'])
    expect(calls[1].opts?.returnValue).toBe('resultRows')

    // キャッシュに canonical_acct キーで保存されている
    expect(profileIdCache.get('alice@example.com')).toBe(42)
  })

  it('既存プロフィールの表示名等を更新する（UPSERT）', () => {
    const { db, calls } = createMockDb([[7]])

    const account1 = createMockAccount({
      acct: 'bob@example.com',
      avatar: 'https://example.com/bob_v1.png',
      display_name: 'Bob v1',
      url: 'https://example.com/@bob',
      username: 'bob',
    })

    ensureProfile(db, account1, 1)

    // キャッシュクリアして、表示名を更新した状態で再度呼ぶ
    profileIdCache.clear()

    const account2 = createMockAccount({
      ...account1,
      avatar: 'https://example.com/bob_v2.png',
      display_name: 'Bob v2',
    })

    const id = ensureProfile(db, account2, 1)

    expect(id).toBe(7)
    // 2回分: (UPSERT + SELECT) × 2
    expect(calls).toHaveLength(4)

    // 2回目の UPSERT で新しい display_name が使われる
    const secondBind = calls[2].opts?.bind as (string | number | null)[]
    expect(secondBind[5]).toBe('Bob v2') // display_name
    expect(secondBind[7]).toBe('https://example.com/bob_v2.png') // avatar_url
  })

  it('キャッシュヒット時はDBにUPSERTしつつキャッシュからIDを返す', () => {
    const { db, calls } = createMockDb([[99]])

    const account = createMockAccount({
      acct: 'carol@example.com',
      display_name: 'Carol',
      url: 'https://example.com/@carol',
      username: 'carol',
    })

    // 1回目: DB にアクセスしてキャッシュに保存
    const id1 = ensureProfile(db, account, 1)
    expect(id1).toBe(99)
    expect(calls).toHaveLength(2) // UPSERT + SELECT

    // 2回目: UPSERT は実行されるが SELECT はスキップ
    const id2 = ensureProfile(db, account, 1)
    expect(id2).toBe(99)
    expect(calls).toHaveLength(3) // UPSERT のみ追加
    expect(calls[2].sql).toContain('INSERT INTO profiles')
  })

  it('acct が FQN 形式でない場合、canonical_acct に host を付加する', () => {
    const { db, calls } = createMockDb([[5]])

    const account = createMockAccount({
      acct: 'localuser', // FQN ではない（ローカルユーザー）
      display_name: 'Local User',
      url: 'https://myserver.com/@localuser',
      username: 'localuser',
    })

    const id = ensureProfile(db, account, 3)

    expect(id).toBe(5)

    // UPSERT の bind で server_id = 3 を使っている
    const bind = calls[0].opts?.bind as (string | number | null)[]
    expect(bind[1]).toBe('localuser') // username
    expect(bind[2]).toBe(3) // server_id
    expect(bind[3]).toBe('localuser') // acct
    expect(bind[4]).toBe('localuser@myserver.com') // canonical_acct (host 付加)

    // SELECT でも canonical_acct で検索
    expect(calls[1].opts?.bind).toEqual(['localuser@myserver.com'])

    // キャッシュキーは canonical_acct
    expect(profileIdCache.get('localuser@myserver.com')).toBe(5)
  })

  it('server_id パラメータを使用する', () => {
    const { db, calls } = createMockDb([[11]])

    const account = createMockAccount({
      acct: 'user1@remote.example.com',
      bot: true,
      display_name: 'User One',
      locked: true,
      url: 'https://remote.example.com/@user1',
      username: 'user1',
    })

    const id = ensureProfile(db, account, 42)

    expect(id).toBe(11)

    // UPSERT bind に server_id が含まれる
    const bind = calls[0].opts?.bind as (string | number | null)[]
    expect(bind[2]).toBe(42) // server_id

    // SELECT bind にも canonical_acct が含まれる
    expect(calls[1].opts?.bind).toEqual(['user1@remote.example.com'])

    // is_locked / is_bot のマッピング確認
    expect(bind[12]).toBe(1) // is_locked (locked: true → 1)
    expect(bind[13]).toBe(1) // is_bot (bot: true → 1)
  })
})

// ─── syncProfileStats ───────────────────────────────────────────

describe('syncProfileStats', () => {
  it('プロフィール統計を同期する（UPSERT）', () => {
    const { db, calls } = createMockDb()

    syncProfileStats(db, 10, {
      followers_count: 100,
      following_count: 200,
      statuses_count: 500,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toContain('INSERT INTO profile_stats')
    expect(calls[0].sql).toContain('ON CONFLICT(profile_id)')
    expect(calls[0].sql).toContain('followers_count')
    expect(calls[0].sql).toContain('following_count')
    expect(calls[0].sql).toContain('statuses_count')
    expect(calls[0].sql).toContain('updated_at')

    const bind = calls[0].opts?.bind as (string | number | null)[]
    expect(bind[0]).toBe(10) // profile_id
    expect(bind[1]).toBe(100) // followers_count
    expect(bind[2]).toBe(200) // following_count
    expect(bind[3]).toBe(500) // statuses_count
    expect(typeof bind[4]).toBe('number') // updated_at (Date.now())
  })
})

// ─── syncProfileFields ─────────────────────────────────────────

describe('syncProfileFields', () => {
  it('プロフィールフィールドを同期する', () => {
    const { db, calls } = createMockDb()

    syncProfileFields(db, 10, [
      {
        name: 'Website',
        value: '<a href="https://example.com">example.com</a>',
      },
      {
        name: 'Verified',
        value: '<a href="https://verified.example.com">verified</a>',
        verified_at: '2024-06-01T00:00:00.000Z',
      },
    ])

    // DELETE + multi-value INSERT
    expect(calls).toHaveLength(2)

    // 1回目: DELETE
    expect(calls[0].sql).toContain('DELETE FROM profile_fields')
    expect(calls[0].opts?.bind).toEqual([10])

    // 2回目: multi-value INSERT
    expect(calls[1].sql).toContain('INSERT INTO profile_fields')
    const bind = calls[1].opts?.bind as (string | number | null)[]
    // 1つ目のフィールド
    expect(bind[0]).toBe(10) // profile_id
    expect(bind[1]).toBe(0) // sort_order
    expect(bind[2]).toBe('Website') // name
    expect(bind[3]).toBe('<a href="https://example.com">example.com</a>') // value
    expect(bind[4]).toBeNull() // verified_at
    // 2つ目のフィールド
    expect(bind[5]).toBe(10) // profile_id
    expect(bind[6]).toBe(1) // sort_order
    expect(bind[7]).toBe('Verified') // name
    expect(bind[9]).toBe('2024-06-01T00:00:00.000Z') // verified_at
  })

  it('既存のフィールドを削除してから新規追加する', () => {
    const { db, calls } = createMockDb()

    // 1回目の同期
    syncProfileFields(db, 5, [{ name: 'Old Field', value: 'old value' }])

    expect(calls).toHaveLength(2) // DELETE + multi-value INSERT

    // 2回目の同期（フィールドを変更）
    syncProfileFields(db, 5, [
      { name: 'New Field', value: 'new value' },
      { name: 'Another Field', value: 'another value' },
    ])

    // 合計: (DELETE + INSERT) + (DELETE + INSERT) = 4
    expect(calls).toHaveLength(4)

    // 2回目の DELETE
    expect(calls[2].sql).toContain('DELETE FROM profile_fields')
    expect(calls[2].opts?.bind).toEqual([5])

    // 2回目の multi-value INSERT で新しいフィールドが追加される
    const bind = calls[3].opts?.bind as (string | number | null)[]
    expect(bind[2]).toBe('New Field')
    expect(bind[7]).toBe('Another Field')
  })
})

// ─── syncProfileCustomEmojis ────────────────────────────────────

describe('syncProfileCustomEmojis', () => {
  beforeEach(() => {
    emojiIdCache.clear()
    ensureCustomEmojiCounter = 0
  })

  it('プロフィールの絵文字を同期する', () => {
    const { db, calls } = createMockDb()

    syncProfileCustomEmojis(db, 10, 1, [
      { shortcode: 'blobcat', url: 'https://example.com/blobcat.png' },
      { shortcode: 'blobfox', url: 'https://example.com/blobfox.png' },
    ])

    // INSERT OR IGNORE INTO profile_custom_emojis が呼ばれる
    const insertCalls = calls.filter(
      (c) =>
        c.sql.includes('INSERT') && c.sql.includes('profile_custom_emojis'),
    )
    expect(insertCalls.length).toBe(2)

    // custom_emoji_id カラムを使っている（旧 emoji_id ではない）
    for (const call of insertCalls) {
      expect(call.sql).toContain('custom_emoji_id')
      expect(call.sql).not.toContain('emoji_id,')
    }

    // DELETE で不要なリンクを掃除
    const deleteCalls = calls.filter(
      (c) =>
        c.sql.includes('DELETE') && c.sql.includes('profile_custom_emojis'),
    )
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1)
    expect(deleteCalls[0].sql).toContain('custom_emoji_id NOT IN')
  })

  it('不要な絵文字リンクを削除する', () => {
    const { db, calls } = createMockDb()

    // 絵文字1つだけを同期 → 以前あった他の絵文字は削除される
    syncProfileCustomEmojis(db, 10, 1, [
      { shortcode: 'blobcat', url: 'https://example.com/blobcat.png' },
    ])

    // DELETE 文で custom_emoji_id NOT IN を使って不要なリンクを削除
    const deleteCalls = calls.filter(
      (c) =>
        c.sql.includes('DELETE') && c.sql.includes('profile_custom_emojis'),
    )
    expect(deleteCalls.length).toBe(1)
    expect(deleteCalls[0].sql).toContain('custom_emoji_id NOT IN')
    expect(deleteCalls[0].opts?.bind).toContain(10) // profile_id
  })

  it('空リストの場合全リンクを削除する', () => {
    const { db, calls } = createMockDb()

    syncProfileCustomEmojis(db, 10, 1, [])

    // INSERT は呼ばれない
    const insertCalls = calls.filter(
      (c) =>
        c.sql.includes('INSERT') && c.sql.includes('profile_custom_emojis'),
    )
    expect(insertCalls).toHaveLength(0)

    // DELETE FROM profile_custom_emojis WHERE profile_id = ?
    const deleteCalls = calls.filter(
      (c) =>
        c.sql.includes('DELETE') && c.sql.includes('profile_custom_emojis'),
    )
    expect(deleteCalls).toHaveLength(1)
    expect(deleteCalls[0].opts?.bind).toEqual([10])
  })
})
