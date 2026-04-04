import type { Entity } from 'megalodon'
import {
  ensureReblogOriginalPost,
  syncPostMedia,
  syncPostStats,
  upsertMentionsInternal,
} from 'util/db/sqlite/worker/handlers/postSync'
import type { DbExec } from 'util/db/sqlite/worker/handlers/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ================================================================
// ヘルパー
// ================================================================

/** db.exec のモックを作成する */
function createMockDb(
  execImpl?: (
    sql: string,
    opts?: { bind?: (string | number | null)[]; returnValue?: 'resultRows' },
  ) => unknown,
): {
  db: DbExec
  calls: {
    sql: string
    opts?: { bind?: (string | number | null)[]; returnValue?: 'resultRows' }
  }[]
} {
  const calls: {
    sql: string
    opts?: { bind?: (string | number | null)[]; returnValue?: 'resultRows' }
  }[] = []

  const db: DbExec = {
    exec: vi.fn(
      (
        sql: string,
        opts?: {
          bind?: (string | number | null)[]
          returnValue?: 'resultRows'
        },
      ) => {
        calls.push({ opts, sql })
        if (execImpl) return execImpl(sql, opts)
        if (opts?.returnValue === 'resultRows') return []
        return undefined
      },
    ),
  }

  return { calls, db }
}

/** テスト用の最小限 Entity.Status モックを生成する */
function createMockStatus(
  overrides: Partial<Entity.Status> = {},
): Entity.Status {
  return {
    account: {
      acct: 'alice@example.com',
      avatar: 'https://example.com/avatar.png',
      avatar_static: 'https://example.com/avatar_static.png',
      bot: false,
      created_at: '2024-01-01T00:00:00.000Z',
      display_name: 'Alice',
      emojis: [],
      fields: [],
      followers_count: 10,
      following_count: 20,
      header: 'https://example.com/header.png',
      header_static: 'https://example.com/header_static.png',
      id: 'account-1',
      locked: false,
      note: '',
      statuses_count: 100,
      url: 'https://example.com/@alice',
      username: 'alice',
    } as Entity.Account,
    bookmarked: false,
    content: '<p>Hello, world!</p>',
    created_at: '2024-06-15T12:30:00.000Z',
    emojis: [],
    favourited: false,
    favourites_count: 5,
    id: '12345',
    media_attachments: [],
    mentions: [],
    muted: false,
    pinned: false,
    reblog: null,
    reblogged: false,
    reblogs_count: 3,
    replies_count: 2,
    sensitive: false,
    spoiler_text: '',
    tags: [],
    uri: 'https://example.com/users/alice/statuses/12345',
    url: 'https://example.com/@alice/12345',
    visibility: 'public' as const,
    ...overrides,
  } as Entity.Status
}

/** テスト用の最小限 Entity.Mention モックを生成する */
function createMockMention(
  overrides: Partial<Entity.Mention> = {},
): Entity.Mention {
  return {
    acct: 'bob@remote.example',
    id: 'mention-1',
    url: 'https://remote.example/@bob',
    username: 'bob',
    ...overrides,
  }
}

/** テスト用の最小限 Entity.Attachment モックを生成する */
function createMockAttachment(
  overrides: Partial<Entity.Attachment> = {},
): Entity.Attachment {
  return {
    blurhash: 'LEHV6nWB2y',
    description: 'A nice image',
    id: 'media-1',
    meta: {
      original: {
        height: 600,
        width: 800,
      },
    } as Entity.Attachment['meta'],
    preview_url: 'https://example.com/media/preview.jpg',
    remote_url: 'https://cdn.example.com/media/original.jpg',
    text_url: null,
    type: 'image',
    url: 'https://example.com/media/original.jpg',
    ...overrides,
  } as Entity.Attachment
}

// ================================================================
// upsertMentionsInternal
// ================================================================
describe('upsertMentionsInternal', () => {
  it('メンションを投稿に関連付けて保存する', () => {
    const { db, calls } = createMockDb()
    const mentions = [createMockMention()]

    upsertMentionsInternal(db, 100, mentions)

    // INSERT が1回呼ばれる
    const insertCalls = calls.filter((c) =>
      c.sql.includes('INSERT INTO post_mentions'),
    )
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0].sql).toContain('post_mentions')
    expect(insertCalls[0].sql).toContain('ON CONFLICT(post_id, acct)')
  })

  it('acct, username, url を保存する', () => {
    const { db, calls } = createMockDb()
    const mention = createMockMention({
      acct: 'carol@other.example',
      url: 'https://other.example/@carol',
      username: 'carol',
    })

    upsertMentionsInternal(db, 200, [mention])

    const insertCalls = calls.filter((c) =>
      c.sql.includes('INSERT INTO post_mentions'),
    )
    expect(insertCalls).toHaveLength(1)

    const bind = insertCalls[0].opts?.bind
    expect(bind).toBeDefined()
    // post_id, acct, username, url が bind に含まれる
    expect(bind).toContain(200)
    expect(bind).toContain('carol@other.example')
    expect(bind).toContain('carol')
    expect(bind).toContain('https://other.example/@carol')
  })

  it('UPSERT で username, url, profile_id を更新する', () => {
    const { db, calls } = createMockDb()
    const mention = createMockMention()

    upsertMentionsInternal(db, 100, [mention])

    const insertCall = calls.find((c) =>
      c.sql.includes('INSERT INTO post_mentions'),
    )
    expect(insertCall).toBeDefined()
    expect(insertCall?.sql).toContain('DO UPDATE SET')
    expect(insertCall?.sql).toContain('username')
    expect(insertCall?.sql).toContain('url')
    expect(insertCall?.sql).toContain('profile_id')
  })

  it('不要なメンションを削除する', () => {
    const { db, calls } = createMockDb()
    const mentions = [createMockMention({ acct: 'bob@remote.example' })]

    upsertMentionsInternal(db, 100, mentions)

    // DELETE 文が呼ばれ、keepAccts に含まれない acct が削除される
    const deleteCalls = calls.filter((c) =>
      c.sql.includes('DELETE FROM post_mentions'),
    )
    expect(deleteCalls).toHaveLength(1)
    expect(deleteCalls[0].sql).toContain('acct NOT IN')
    expect(deleteCalls[0].opts?.bind).toContain(100)
    expect(deleteCalls[0].opts?.bind).toContain('bob@remote.example')
  })

  it('メンションが空の場合すべて削除する', () => {
    const { db, calls } = createMockDb()

    upsertMentionsInternal(db, 100, [])

    const deleteCalls = calls.filter((c) =>
      c.sql.includes('DELETE FROM post_mentions'),
    )
    expect(deleteCalls).toHaveLength(1)
    expect(deleteCalls[0].sql).not.toContain('NOT IN')
    expect(deleteCalls[0].opts?.bind).toEqual([100])
  })

  it('profile_aliases を参照しない', () => {
    const { db, calls } = createMockDb()
    const mentions = [createMockMention()]

    upsertMentionsInternal(db, 100, mentions)

    const aliasQueries = calls.filter((c) => c.sql.includes('profile_aliases'))
    expect(aliasQueries).toHaveLength(0)
  })

  it('posts_mentions テーブルを使用しない（post_mentions を使用する）', () => {
    const { db, calls } = createMockDb()
    const mentions = [createMockMention()]

    upsertMentionsInternal(db, 100, mentions)

    for (const call of calls) {
      // "posts_mentions" が含まれていないことを確認
      // ただし "post_mentions" は許可（"posts_mentions" は "post_mentions" を含むので正規表現で判定）
      expect(call.sql).not.toMatch(/\bposts_mentions\b/)
    }
  })
})

// ================================================================
// syncPostMedia
// ================================================================
describe('syncPostMedia', () => {
  it('メディア添付ファイルを投稿に関連付けて保存する', () => {
    const { db, calls } = createMockDb((sql) => {
      // resolveMediaTypeId: media_types テーブルからの SELECT
      if (typeof sql === 'string' && sql.includes('media_types')) {
        return [[1]] // image = 1
      }
      return undefined
    })

    const attachments = [createMockAttachment()]

    syncPostMedia(db, 100, attachments)

    const insertCalls = calls.filter((c) =>
      c.sql.includes('INSERT INTO post_media'),
    )
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0].opts?.bind).toContain(100) // post_id
    expect(insertCalls[0].opts?.bind).toContain(
      'https://example.com/media/original.jpg',
    ) // url
  })

  it('media_local_id を保存する', () => {
    const { db, calls } = createMockDb((sql) => {
      if (typeof sql === 'string' && sql.includes('media_types')) {
        return [[1]]
      }
      return undefined
    })

    const attachments = [createMockAttachment({ id: 'remote-media-42' })]

    syncPostMedia(db, 100, attachments)

    const insertCalls = calls.filter((c) =>
      c.sql.includes('INSERT INTO post_media'),
    )
    expect(insertCalls).toHaveLength(1)

    // media_local_id が bind に含まれている
    expect(insertCalls[0].opts?.bind).toContain('remote-media-42')

    // SQL に media_local_id カラムが含まれている
    expect(insertCalls[0].sql).toContain('media_local_id')
  })

  it('width と height を attachment.meta.original から抽出する', () => {
    const { db, calls } = createMockDb((sql) => {
      if (typeof sql === 'string' && sql.includes('media_types')) {
        return [[1]]
      }
      return undefined
    })

    const attachments = [
      createMockAttachment({
        meta: {
          original: { height: 1080, width: 1920 },
        } as Entity.Attachment['meta'],
      }),
    ]

    syncPostMedia(db, 100, attachments)

    const insertCalls = calls.filter((c) =>
      c.sql.includes('INSERT INTO post_media'),
    )
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0].opts?.bind).toContain(1920)
    expect(insertCalls[0].opts?.bind).toContain(1080)
  })

  it('meta が存在しない場合 width/height は null になる', () => {
    const { db, calls } = createMockDb((sql) => {
      if (typeof sql === 'string' && sql.includes('media_types')) {
        return [[1]]
      }
      return undefined
    })

    const attachments = [
      createMockAttachment({
        meta: null as unknown as Entity.Attachment['meta'],
      }),
    ]

    syncPostMedia(db, 100, attachments)

    const insertCalls = calls.filter((c) =>
      c.sql.includes('INSERT INTO post_media'),
    )
    expect(insertCalls).toHaveLength(1)

    // width, height が null として渡される
    const bind = insertCalls[0].opts?.bind as (string | number | null)[]
    // url の後に width, height が来る。null が含まれていることを確認
    const nullCount = bind.filter((v) => v === null).length
    expect(nullCount).toBeGreaterThanOrEqual(2) // width=null, height=null (最低限)
  })

  it('既存メディアを削除してから新規追加する', () => {
    const { db, calls } = createMockDb((sql) => {
      if (typeof sql === 'string' && sql.includes('media_types')) {
        return [[1]]
      }
      return undefined
    })

    const attachments = [createMockAttachment()]

    syncPostMedia(db, 100, attachments)

    // DELETE 文が呼ばれる
    const deleteCalls = calls.filter((c) =>
      c.sql.includes('DELETE FROM post_media'),
    )
    expect(deleteCalls).toHaveLength(1)
    expect(deleteCalls[0].opts?.bind).toContain(100) // post_id
  })

  it('remote_media_id カラムを使用しない', () => {
    const { db, calls } = createMockDb((sql) => {
      if (typeof sql === 'string' && sql.includes('media_types')) {
        return [[1]]
      }
      return undefined
    })

    syncPostMedia(db, 100, [createMockAttachment()])

    for (const call of calls) {
      expect(call.sql).not.toContain('remote_media_id')
    }
  })

  it('duration_ms カラムを使用しない', () => {
    const { db, calls } = createMockDb((sql) => {
      if (typeof sql === 'string' && sql.includes('media_types')) {
        return [[1]]
      }
      return undefined
    })

    syncPostMedia(db, 100, [createMockAttachment()])

    for (const call of calls) {
      expect(call.sql).not.toContain('duration_ms')
    }
  })

  it('is_sensitive カラムを使用しない', () => {
    const { db, calls } = createMockDb((sql) => {
      if (typeof sql === 'string' && sql.includes('media_types')) {
        return [[1]]
      }
      return undefined
    })

    syncPostMedia(db, 100, [createMockAttachment()])

    for (const call of calls) {
      expect(call.sql).not.toContain('is_sensitive')
    }
  })

  it('複数のメディアを sort_order 付きで保存する', () => {
    const { db, calls } = createMockDb((sql) => {
      if (typeof sql === 'string' && sql.includes('media_types')) {
        return [[1]]
      }
      return undefined
    })

    const attachments = [
      createMockAttachment({ id: 'media-1' }),
      createMockAttachment({ id: 'media-2', type: 'video' }),
    ]

    syncPostMedia(db, 100, attachments)

    const insertCalls = calls.filter((c) =>
      c.sql.includes('INSERT INTO post_media'),
    )
    // multi-value INSERT で1回
    expect(insertCalls).toHaveLength(1)

    // bind に sort_order 0 と 1 が含まれる
    const bind = insertCalls[0].opts?.bind as (string | number | null)[]
    expect(bind).toContain(0) // sort_order for first
    expect(bind).toContain(1) // sort_order for second
    expect(bind).toContain('media-1')
    expect(bind).toContain('media-2')
  })
})

// ================================================================
// syncPostStats
// ================================================================
describe('syncPostStats', () => {
  it('投稿統計を保存する（UPSERT）', () => {
    const { db, calls } = createMockDb()
    const status = createMockStatus({
      favourites_count: 10,
      reblogs_count: 5,
      replies_count: 3,
    })

    syncPostStats(db, 100, status)

    expect(calls).toHaveLength(1)

    const sql = calls[0].sql
    expect(sql).toContain('INSERT INTO post_stats')
    expect(sql).toContain('ON CONFLICT(post_id) DO UPDATE SET')
    expect(sql).toContain('replies_count')
    expect(sql).toContain('reblogs_count')
    expect(sql).toContain('favourites_count')

    const bind = calls[0].opts?.bind
    expect(bind).toContain(100) // post_id
    expect(bind).toContain(3) // replies_count
    expect(bind).toContain(5) // reblogs_count
    expect(bind).toContain(10) // favourites_count
  })

  it('emoji_reactions_json を保存する', () => {
    const { db, calls } = createMockDb()
    const status = createMockStatus({
      emoji_reactions: [
        {
          account_ids: ['1', '2'],
          count: 2,
          me: true,
          name: '👍',
          static_url: 'https://example.com/thumbsup_static.png',
          url: 'https://example.com/thumbsup.png',
        },
      ],
    } as Partial<Entity.Status>)

    syncPostStats(db, 100, status)

    const sql = calls[0].sql
    expect(sql).toContain('emoji_reactions_json')

    const bind = calls[0].opts?.bind as (string | number | null)[]
    // emoji_reactions_json が JSON 文字列として bind に含まれる
    const jsonBind = bind.find((v) => typeof v === 'string' && v.includes('👍'))
    expect(jsonBind).toBeDefined()
    const parsed = JSON.parse(jsonBind as string)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].name).toBe('👍')
    expect(parsed[0].count).toBe(2)
  })

  it('emoji_reactions が空の場合 "[]" を保存する', () => {
    const { db, calls } = createMockDb()
    const status = createMockStatus()

    syncPostStats(db, 100, status)

    const bind = calls[0].opts?.bind as (string | number | null)[]
    // emoji_reactions_json は空JSON配列文字列
    // post_id(100), replies_count, reblogs_count, favourites_count, emoji_reactions_json, updated_at
    // '[]' が含まれていることを確認（emoji_reactions_json 位置）
    expect(bind).toContain('[]')
  })

  it('updated_at を保存する', () => {
    const { db, calls } = createMockDb()
    const status = createMockStatus()

    syncPostStats(db, 100, status)

    const sql = calls[0].sql
    expect(sql).toContain('updated_at')
  })

  it('fetched_at カラムを使用しない', () => {
    const { db, calls } = createMockDb()
    const status = createMockStatus()

    syncPostStats(db, 100, status)

    expect(calls[0].sql).not.toContain('fetched_at')
  })

  it('reactions_count カラムを使用しない', () => {
    const { db, calls } = createMockDb()
    const status = createMockStatus()

    syncPostStats(db, 100, status)

    expect(calls[0].sql).not.toContain('reactions_count')
  })

  it('quotes_count カラムを使用しない', () => {
    const { db, calls } = createMockDb()
    const status = createMockStatus()

    syncPostStats(db, 100, status)

    expect(calls[0].sql).not.toContain('quotes_count')
  })
})

// ================================================================
// ensureReblogOriginalPost
// ================================================================

// helpers をモック化
vi.mock('util/db/sqlite/helpers', () => ({
  ensureProfile: vi.fn(() => 10),
  extractPostColumns: vi.fn(() => ({
    application_name: null,
    canonical_url: 'https://example.com/@alice/12345',
    content_html: '<p>Hello, world!</p>',
    created_at_ms: 1718451000000,
    edited_at_ms: null,
    in_reply_to_account_acct: null,
    in_reply_to_uri: null,
    is_local_only: 0,
    is_sensitive: 0,
    language: 'ja',
    object_uri: 'https://example.com/users/alice/statuses/12345',
    plain_content: 'Hello, world!',
    quote_state: null,
    spoiler_text: '',
    visibility_id: 1,
  })),
  resolveEmojisFromDb: vi.fn(() => []),
  syncLinkCard: vi.fn(),
  syncPollData: vi.fn(),
  syncPostCustomEmojis: vi.fn(),
  syncPostHashtags: vi.fn(),
  syncProfileCustomEmojis: vi.fn(),
  updateInteraction: vi.fn(),
}))

vi.mock('util/db/sqlite/worker/handlers/statusHelpers', () => ({
  deriveAccountDomain: vi.fn(() => 'example.com'),
  getLastInsertRowId: vi.fn(() => 999),
  resolveMediaTypeId: vi.fn(() => 1),
  resolvePostIdInternal: vi.fn(() => undefined),
  resolveReplyToPostId: vi.fn(() => null),
  resolveRepostOfPostId: vi.fn(() => null),
  resolveVisibilityId: vi.fn(() => 1),
}))

// モジュールを動的にインポート（vi.mock の後）
const helpersModule = await import('util/db/sqlite/helpers')
const statusHelpersModule = await import(
  'util/db/sqlite/worker/handlers/statusHelpers'
)

describe('ensureReblogOriginalPost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // デフォルト: resolvePostIdInternal は undefined を返す（新規投稿扱い）
    vi.mocked(statusHelpersModule.resolvePostIdInternal).mockReturnValue(
      undefined,
    )
    vi.mocked(statusHelpersModule.getLastInsertRowId).mockReturnValue(999)
  })

  it('リブログ元の投稿をDBに保存する', () => {
    const { db, calls } = createMockDb((sql) => {
      // URI で既存投稿を検索 → 見つからない
      if (
        typeof sql === 'string' &&
        sql.includes('SELECT') &&
        sql.includes('object_uri')
      ) {
        return []
      }
      return undefined
    })

    const originalStatus = createMockStatus({
      uri: 'https://example.com/users/alice/statuses/original-1',
    })

    ensureReblogOriginalPost(
      db,
      originalStatus,
      'https://example.com',
      1,
      Date.now(),
      42,
    )

    // INSERT INTO posts ( が呼ばれている（post_backend_ids 等は除外）
    const postInserts = calls.filter((c) =>
      c.sql.includes('INSERT INTO posts ('),
    )
    expect(postInserts.length).toBeGreaterThanOrEqual(1)
  })

  it('post_backend_ids にエントリを追加する', () => {
    const { db, calls } = createMockDb((sql) => {
      if (
        typeof sql === 'string' &&
        sql.includes('SELECT') &&
        sql.includes('object_uri')
      ) {
        return []
      }
      return undefined
    })

    const originalStatus = createMockStatus({
      id: 'remote-post-555',
      uri: 'https://example.com/users/alice/statuses/555',
    })

    ensureReblogOriginalPost(
      db,
      originalStatus,
      'https://example.com',
      1,
      Date.now(),
      42,
    )

    // post_backend_ids への INSERT が呼ばれている
    const backendIdInserts = calls.filter((c) =>
      c.sql.includes('post_backend_ids'),
    )
    expect(backendIdInserts.length).toBeGreaterThanOrEqual(1)
    expect(backendIdInserts[0].sql).toContain('INSERT')
    expect(backendIdInserts[0].sql).toContain('post_backend_ids')
  })

  it('posts_backends テーブルを使用しない', () => {
    const { db, calls } = createMockDb((sql) => {
      if (
        typeof sql === 'string' &&
        sql.includes('SELECT') &&
        sql.includes('object_uri')
      ) {
        return []
      }
      return undefined
    })

    const originalStatus = createMockStatus({
      uri: 'https://example.com/users/alice/statuses/123',
    })

    ensureReblogOriginalPost(
      db,
      originalStatus,
      'https://example.com',
      1,
      Date.now(),
      42,
    )

    for (const call of calls) {
      expect(call.sql).not.toMatch(/\bposts_backends\b/)
    }
  })

  it('ensureProfile を新シグネチャ (db, account, serverId) で呼び出す', () => {
    const { db } = createMockDb((sql) => {
      if (
        typeof sql === 'string' &&
        sql.includes('SELECT') &&
        sql.includes('object_uri')
      ) {
        return []
      }
      return undefined
    })

    const originalStatus = createMockStatus({
      uri: 'https://example.com/users/alice/statuses/789',
    })

    ensureReblogOriginalPost(
      db,
      originalStatus,
      'https://example.com',
      7,
      Date.now(),
      42,
    )

    // ensureProfile が (db, account, serverId) の3引数で呼ばれている
    expect(helpersModule.ensureProfile).toHaveBeenCalled()
    const callArgs = vi.mocked(helpersModule.ensureProfile).mock.calls[0]
    expect(callArgs).toHaveLength(3)
    expect(callArgs[0]).toBe(db) // db
    expect(callArgs[1]).toBe(originalStatus.account) // account
    expect(callArgs[2]).toBe(7) // serverId
  })

  it('ensureProfileAlias を呼び出さない', () => {
    const { db, calls } = createMockDb((sql) => {
      if (
        typeof sql === 'string' &&
        sql.includes('SELECT') &&
        sql.includes('object_uri')
      ) {
        return []
      }
      return undefined
    })

    const originalStatus = createMockStatus({
      uri: 'https://example.com/users/alice/statuses/456',
    })

    ensureReblogOriginalPost(
      db,
      originalStatus,
      'https://example.com',
      1,
      Date.now(),
      42,
    )

    // profile_aliases テーブルへのアクセスがない
    for (const call of calls) {
      expect(call.sql).not.toContain('profile_aliases')
    }
  })

  it('posts_reblogs テーブルへの INSERT を行わない', () => {
    const { db, calls } = createMockDb((sql) => {
      if (
        typeof sql === 'string' &&
        sql.includes('SELECT') &&
        sql.includes('object_uri')
      ) {
        return []
      }
      return undefined
    })

    const originalStatus = createMockStatus({
      uri: 'https://example.com/users/alice/statuses/321',
    })

    ensureReblogOriginalPost(
      db,
      originalStatus,
      'https://example.com',
      1,
      Date.now(),
      42,
    )

    for (const call of calls) {
      expect(call.sql).not.toContain('posts_reblogs')
    }
  })

  it('updateInteraction を使用する（toggleEngagement ではない）', () => {
    const { db } = createMockDb((sql) => {
      if (
        typeof sql === 'string' &&
        sql.includes('SELECT') &&
        sql.includes('object_uri')
      ) {
        return []
      }
      return undefined
    })

    const originalStatus = createMockStatus({
      favourited: true,
      reblogged: true,
      uri: 'https://example.com/users/alice/statuses/engagement-1',
    })

    ensureReblogOriginalPost(
      db,
      originalStatus,
      'https://example.com',
      1,
      Date.now(),
      42,
    )

    // updateInteraction が呼ばれている
    expect(helpersModule.updateInteraction).toHaveBeenCalled()
  })

  it('URI が空の場合何もしない', () => {
    const { db, calls } = createMockDb()

    const originalStatus = createMockStatus({ uri: '' })

    ensureReblogOriginalPost(
      db,
      originalStatus,
      'https://example.com',
      1,
      Date.now(),
      42,
    )

    // DB アクセスが行われないことを確認
    expect(calls).toHaveLength(0)
  })

  it('resolveDelayedReplyReferences を呼び出さない', () => {
    const { db, calls } = createMockDb((sql) => {
      if (
        typeof sql === 'string' &&
        sql.includes('SELECT') &&
        sql.includes('object_uri')
      ) {
        return []
      }
      return undefined
    })

    const originalStatus = createMockStatus({
      uri: 'https://example.com/users/alice/statuses/no-delay',
    })

    ensureReblogOriginalPost(
      db,
      originalStatus,
      'https://example.com',
      1,
      Date.now(),
      42,
    )

    // 遅延参照解決の SQL が呼ばれていない
    const delayedCalls = calls.filter(
      (c) =>
        c.sql.includes('reply_to_post_id') &&
        c.sql.includes('UPDATE posts') &&
        c.sql.includes('in_reply_to_id'),
    )
    expect(delayedCalls).toHaveLength(0)
  })

  it('resolveDelayedRepostReferences を呼び出さない', () => {
    const { db, calls } = createMockDb((sql) => {
      if (
        typeof sql === 'string' &&
        sql.includes('SELECT') &&
        sql.includes('object_uri')
      ) {
        return []
      }
      return undefined
    })

    const originalStatus = createMockStatus({
      uri: 'https://example.com/users/alice/statuses/no-delay-repost',
    })

    ensureReblogOriginalPost(
      db,
      originalStatus,
      'https://example.com',
      1,
      Date.now(),
      42,
    )

    // 遅延リポスト解決の SQL が呼ばれていない
    const delayedCalls = calls.filter(
      (c) =>
        c.sql.includes('repost_of_post_id') &&
        c.sql.includes('UPDATE posts') &&
        c.sql.includes('reblog_of_uri'),
    )
    expect(delayedCalls).toHaveLength(0)
  })
})
