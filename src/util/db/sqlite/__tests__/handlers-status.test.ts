import type { Entity } from 'megalodon'
import type { DbExec } from 'util/db/sqlite/worker/handlers/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ================================================================
// ヘルパー
// ================================================================

type ExecCall = {
  sql: string
  opts?: { bind?: (string | number | null)[]; returnValue?: 'resultRows' }
}

/** db.exec のモックを作成する */
function createMockDb(
  execImpl?: (
    sql: string,
    opts?: { bind?: (string | number | null)[]; returnValue?: 'resultRows' },
  ) => unknown,
): {
  db: DbExec
  calls: ExecCall[]
} {
  const calls: ExecCall[] = []

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

// ================================================================
// モック設定
// ================================================================

vi.mock('util/db/sqlite/helpers', () => ({
  buildTimelineKey: vi.fn((type: string, opts?: { tag?: string }) =>
    type === 'tag' ? `tag:${opts?.tag ?? ''}` : type,
  ),
  ensureProfile: vi.fn(() => 10),
  ensureServer: vi.fn(() => 1),
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
  resolveLocalAccountId: vi.fn(() => 100),
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
  resolvePostIdInternal: vi.fn(() => undefined),
  resolveReplyToPostId: vi.fn(() => null),
  resolveRepostOfPostId: vi.fn(() => null),
  resolveVisibilityId: vi.fn(() => 1),
}))

vi.mock('util/db/sqlite/worker/handlers/postSync', () => ({
  ensureReblogOriginalPost: vi.fn(),
  syncPostMedia: vi.fn(),
  syncPostStats: vi.fn(),
  upsertMentionsInternal: vi.fn(),
}))

// モジュールを動的にインポート（vi.mock の後）
const helpersModule = await import('util/db/sqlite/helpers')
const statusHelpersModule = await import(
  'util/db/sqlite/worker/handlers/statusHelpers'
)
const postSyncModule = await import('util/db/sqlite/worker/handlers/postSync')
const { handleUpsertStatus, handleBulkUpsertStatuses } = await import(
  'util/db/sqlite/worker/handlers/statusHandlers'
)

// ================================================================
// handleUpsertStatus
// ================================================================

describe('handleUpsertStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // デフォルト: resolvePostIdInternal は undefined を返す（新規投稿扱い）
    vi.mocked(statusHelpersModule.resolvePostIdInternal).mockReturnValue(
      undefined,
    )
    vi.mocked(statusHelpersModule.getLastInsertRowId).mockReturnValue(999)
    vi.mocked(helpersModule.resolveLocalAccountId).mockReturnValue(100)
    vi.mocked(helpersModule.ensureServer).mockReturnValue(1)
    vi.mocked(helpersModule.ensureProfile).mockReturnValue(10)
    vi.mocked(statusHelpersModule.resolveVisibilityId).mockReturnValue(1)
  })

  it('投稿をDBに保存する', () => {
    const { db, calls } = createMockDb()
    const status = createMockStatus()

    handleUpsertStatus(
      db,
      JSON.stringify(status),
      'https://example.com',
      'home',
    )

    // INSERT INTO posts が発行されていること
    const postInserts = calls.filter((c) => c.sql.includes('INSERT INTO posts'))
    expect(postInserts.length).toBeGreaterThanOrEqual(1)

    // 新スキーマのカラムが含まれること
    const insertSql = postInserts[0].sql
    expect(insertSql).toContain('last_fetched_at')
    expect(insertSql).toContain('edited_at_ms')
    expect(insertSql).toContain('plain_content')
    expect(insertSql).toContain('in_reply_to_uri')
    expect(insertSql).toContain('in_reply_to_account_acct')
    expect(insertSql).toContain('quote_state')
    expect(insertSql).toContain('is_local_only')
    expect(insertSql).toContain('application_name')
    expect(insertSql).toContain('reblog_of_post_id')
    expect(insertSql).toContain('quote_of_post_id')

    // 旧スキーマのカラムが含まれないこと
    expect(insertSql).not.toContain('stored_at')
    expect(insertSql).not.toContain('has_media')
    expect(insertSql).not.toContain('media_count')
    expect(insertSql).not.toContain('has_spoiler')
    expect(insertSql).not.toContain('reblog_of_uri')

    // PK は id であること（WHERE post_id ではない）
    // INSERT なので WHERE はないが、SELECT で確認
    const selectPosts = calls.filter(
      (c) => c.sql.includes('SELECT') && c.sql.includes('FROM posts'),
    )
    for (const sel of selectPosts) {
      expect(sel.sql).not.toMatch(/\bpost_id\b/)
    }
  })

  it('post_backend_ids にエントリを追加する', () => {
    const { db, calls } = createMockDb()
    const status = createMockStatus()

    handleUpsertStatus(
      db,
      JSON.stringify(status),
      'https://example.com',
      'home',
    )

    const backendIdInserts = calls.filter(
      (c) => c.sql.includes('INSERT') && c.sql.includes('post_backend_ids'),
    )
    expect(backendIdInserts.length).toBe(1)

    // local_account_id が含まれること
    expect(backendIdInserts[0].sql).toContain('local_account_id')

    // bind に localAccountId (100), localId ('12345'), serverId (1) が含まれること
    const bind = backendIdInserts[0].opts?.bind as (string | number | null)[]
    expect(bind).toContain(100) // localAccountId
    expect(bind).toContain('12345') // status.id
    expect(bind).toContain(1) // serverId
  })

  it('timeline_entries にエントリを追加する', () => {
    const { db, calls } = createMockDb()
    const status = createMockStatus()

    handleUpsertStatus(
      db,
      JSON.stringify(status),
      'https://example.com',
      'home',
    )

    const timelineInserts = calls.filter(
      (c) => c.sql.includes('INSERT') && c.sql.includes('timeline_entries'),
    )
    expect(timelineInserts.length).toBe(1)

    // buildTimelineKey が呼ばれたこと
    expect(helpersModule.buildTimelineKey).toHaveBeenCalledWith('home', {
      tag: undefined,
    })

    // local_account_id, timeline_key, post_id, display_post_id, created_at_ms が含まれること
    expect(timelineInserts[0].sql).toContain('local_account_id')
    expect(timelineInserts[0].sql).toContain('timeline_key')
    expect(timelineInserts[0].sql).toContain('display_post_id')
    expect(timelineInserts[0].sql).toContain('created_at_ms')

    // timeline_items / timeline_item_kind_id を使用しないこと
    expect(timelineInserts[0].sql).not.toContain('timeline_items')
    expect(timelineInserts[0].sql).not.toContain('timeline_item_kind_id')
  })

  it('プロフィールを保存する', () => {
    const { db } = createMockDb()
    const status = createMockStatus()

    handleUpsertStatus(
      db,
      JSON.stringify(status),
      'https://example.com',
      'home',
    )

    // ensureServer が host で呼ばれること（backendUrl ではない）
    expect(helpersModule.ensureServer).toHaveBeenCalledWith(db, 'example.com')

    // ensureProfile が新シグネチャ (db, account, serverId) で呼ばれること
    const callArgs = vi.mocked(helpersModule.ensureProfile).mock.calls[0]
    expect(callArgs).toHaveLength(3)
    expect(callArgs[0]).toBe(db)
    expect(callArgs[1]).toEqual(
      expect.objectContaining({ acct: 'alice@example.com' }),
    )
    expect(callArgs[2]).toBe(1) // serverId
  })

  it('インタラクション（favourite/reblog/bookmark）を保存する', () => {
    const { db } = createMockDb()
    const status = createMockStatus({
      bookmarked: true,
      favourited: true,
      reblogged: true,
    })

    handleUpsertStatus(
      db,
      JSON.stringify(status),
      'https://example.com',
      'home',
    )

    // updateInteraction が呼ばれること（toggleEngagement ではない）
    expect(helpersModule.updateInteraction).toHaveBeenCalledWith(
      db,
      999,
      100,
      'favourite',
      true,
    )
    expect(helpersModule.updateInteraction).toHaveBeenCalledWith(
      db,
      999,
      100,
      'reblog',
      true,
    )
    expect(helpersModule.updateInteraction).toHaveBeenCalledWith(
      db,
      999,
      100,
      'bookmark',
      true,
    )
  })

  it('インタラクションが false の場合も updateInteraction を呼び出す', () => {
    const { db } = createMockDb()
    const status = createMockStatus({
      bookmarked: false,
      favourited: false,
      reblogged: false,
    })

    handleUpsertStatus(
      db,
      JSON.stringify(status),
      'https://example.com',
      'home',
    )

    expect(helpersModule.updateInteraction).toHaveBeenCalledWith(
      db,
      999,
      100,
      'favourite',
      false,
    )
    expect(helpersModule.updateInteraction).toHaveBeenCalledWith(
      db,
      999,
      100,
      'reblog',
      false,
    )
    expect(helpersModule.updateInteraction).toHaveBeenCalledWith(
      db,
      999,
      100,
      'bookmark',
      false,
    )
  })

  it('リブログの場合、元投稿を先に保存する', () => {
    const originalStatus = createMockStatus({
      id: 'original-1',
      uri: 'https://example.com/users/bob/statuses/99999',
    })
    const reblogStatus = createMockStatus({
      id: 'reblog-1',
      reblog: originalStatus,
      uri: 'https://example.com/users/alice/statuses/reblog-1',
    })

    const callOrder: string[] = []
    vi.mocked(postSyncModule.ensureReblogOriginalPost).mockImplementation(
      () => {
        callOrder.push('ensureReblogOriginalPost')
      },
    )

    const { db, calls: _calls } = createMockDb((sql) => {
      if (sql.includes('INSERT INTO posts')) {
        callOrder.push('INSERT INTO posts')
      }
      if (sql.includes('SELECT') && sql.includes('FROM posts')) {
        return []
      }
      return undefined
    })

    handleUpsertStatus(
      db,
      JSON.stringify(reblogStatus),
      'https://example.com',
      'home',
    )

    // ensureReblogOriginalPost が呼ばれたこと
    expect(postSyncModule.ensureReblogOriginalPost).toHaveBeenCalled()

    // ensureReblogOriginalPost が INSERT INTO posts より先に呼ばれたこと
    const reblogIndex = callOrder.indexOf('ensureReblogOriginalPost')
    const insertIndex = callOrder.indexOf('INSERT INTO posts')
    expect(reblogIndex).toBeGreaterThanOrEqual(0)
    expect(insertIndex).toBeGreaterThanOrEqual(0)
    expect(reblogIndex).toBeLessThan(insertIndex)
  })

  it('リブログの場合、display_post_id にリブログ元の post_id を設定する', () => {
    // resolveRepostOfPostId がリブログ元の postId を返すように設定
    vi.mocked(statusHelpersModule.resolveRepostOfPostId).mockReturnValue(500)

    const originalStatus = createMockStatus({
      id: 'original-1',
      uri: 'https://example.com/users/bob/statuses/99999',
    })
    const reblogStatus = createMockStatus({
      id: 'reblog-1',
      reblog: originalStatus,
      uri: 'https://example.com/users/alice/statuses/reblog-1',
    })

    const { db, calls } = createMockDb()

    handleUpsertStatus(
      db,
      JSON.stringify(reblogStatus),
      'https://example.com',
      'home',
    )

    const timelineInserts = calls.filter(
      (c) => c.sql.includes('INSERT') && c.sql.includes('timeline_entries'),
    )
    expect(timelineInserts.length).toBe(1)

    // display_post_id が null ではなく、reblogOfPostId (500) であること
    const bind = timelineInserts[0].opts?.bind as (string | number | null)[]
    expect(bind).toContain(500)
  })

  it('posts_reblogs テーブルを使用しない', () => {
    const originalStatus = createMockStatus({
      id: 'original-1',
      uri: 'https://example.com/users/bob/statuses/99999',
    })
    const reblogStatus = createMockStatus({
      id: 'reblog-1',
      reblog: originalStatus,
      uri: 'https://example.com/users/alice/statuses/reblog-1',
    })

    const { db, calls } = createMockDb()

    handleUpsertStatus(
      db,
      JSON.stringify(reblogStatus),
      'https://example.com',
      'home',
    )

    const reblogTableCalls = calls.filter((c) =>
      c.sql.includes('posts_reblogs'),
    )
    expect(reblogTableCalls).toHaveLength(0)
  })

  it('posts_backends テーブルを使用しない', () => {
    const { db, calls } = createMockDb()
    const status = createMockStatus()

    handleUpsertStatus(
      db,
      JSON.stringify(status),
      'https://example.com',
      'home',
    )

    const backendsCalls = calls.filter((c) => c.sql.includes('posts_backends'))
    expect(backendsCalls).toHaveLength(0)
  })

  it('ensureTimeline を呼び出さない', () => {
    const { db, calls } = createMockDb()
    const status = createMockStatus()

    handleUpsertStatus(
      db,
      JSON.stringify(status),
      'https://example.com',
      'home',
    )

    // timeline_items テーブルへの参照がないこと
    const timelineItemsCalls = calls.filter((c) =>
      c.sql.includes('timeline_items'),
    )
    expect(timelineItemsCalls).toHaveLength(0)
  })

  it('ensureProfileAlias を呼び出さない', () => {
    const { db, calls } = createMockDb()
    const status = createMockStatus()

    handleUpsertStatus(
      db,
      JSON.stringify(status),
      'https://example.com',
      'home',
    )

    // profile_aliases テーブルへの参照がないこと
    const aliasCalls = calls.filter((c) => c.sql.includes('profile_aliases'))
    expect(aliasCalls).toHaveLength(0)
  })

  it('resolveDelayedReplyReferences / resolveDelayedRepostReferences を呼び出さない', () => {
    const { db, calls } = createMockDb()
    const status = createMockStatus()

    handleUpsertStatus(
      db,
      JSON.stringify(status),
      'https://example.com',
      'home',
    )

    // delayed reference 関連の SQL がないこと
    const delayedCalls = calls.filter(
      (c) =>
        c.sql.includes('reply_to_post_id') &&
        c.sql.includes('UPDATE') &&
        c.sql.includes('posts') &&
        !c.sql.includes('INSERT'),
    )
    // handleUpsertStatus 自体の UPDATE は許容するが、
    // delayed resolution 的な別テーブル参照パターンは禁止
    for (const call of delayedCalls) {
      expect(call.sql).not.toMatch(/UPDATE\s+posts\s+SET\s+reply_to_post_id/)
    }
  })

  it('既存投稿の場合 UPDATE を発行する', () => {
    // URI で既存投稿が見つかるように設定
    const { db, calls } = createMockDb((sql) => {
      if (
        sql.includes('SELECT') &&
        sql.includes('FROM posts') &&
        sql.includes('object_uri')
      ) {
        return [[42, 0]] // id=42, is_reblog=0
      }
      return undefined
    })
    const status = createMockStatus()

    handleUpsertStatus(
      db,
      JSON.stringify(status),
      'https://example.com',
      'home',
    )

    const updateCalls = calls.filter((c) => c.sql.includes('UPDATE posts SET'))
    expect(updateCalls.length).toBeGreaterThanOrEqual(1)

    // 新カラムが含まれること
    const updateSql = updateCalls[0].sql
    expect(updateSql).toContain('last_fetched_at')
    expect(updateSql).toContain('edited_at_ms')
    expect(updateSql).toContain('plain_content')
    expect(updateSql).toContain('in_reply_to_account_acct')
    expect(updateSql).toContain('application_name')
    expect(updateSql).toContain('reblog_of_post_id')

    // 旧カラムが含まれないこと
    expect(updateSql).not.toContain('stored_at')
    expect(updateSql).not.toContain('has_media')
    expect(updateSql).not.toContain('media_count')
    expect(updateSql).not.toContain('has_spoiler')
    expect(updateSql).not.toContain('reblog_of_uri')

    // WHERE id = ? であること（WHERE post_id = ? ではない）
    expect(updateSql).toMatch(/WHERE\s+id\s*=/)
    expect(updateSql).not.toMatch(/WHERE\s+post_id\s*=/)
  })

  it('upsertMentionsInternal を serverId なしで呼び出す', () => {
    const { db } = createMockDb()
    const status = createMockStatus()

    handleUpsertStatus(
      db,
      JSON.stringify(status),
      'https://example.com',
      'home',
    )

    // upsertMentionsInternal が (db, postId, mentions) の 3 引数で呼ばれること
    const mentionCalls = vi.mocked(postSyncModule.upsertMentionsInternal).mock
      .calls
    expect(mentionCalls.length).toBe(1)
    expect(mentionCalls[0]).toHaveLength(3)
    expect(mentionCalls[0][0]).toBe(db)
    expect(mentionCalls[0][1]).toBe(999) // postId
  })

  it('syncPostMedia を sensitive 引数なしで呼び出す', () => {
    const { db } = createMockDb()
    const status = createMockStatus()

    handleUpsertStatus(
      db,
      JSON.stringify(status),
      'https://example.com',
      'home',
    )

    // syncPostMedia が (db, postId, mediaAttachments) の 3 引数で呼ばれること
    const mediaCalls = vi.mocked(postSyncModule.syncPostMedia).mock.calls
    expect(mediaCalls.length).toBe(1)
    expect(mediaCalls[0]).toHaveLength(3)
  })

  it('トランザクション内で処理する', () => {
    const { db, calls } = createMockDb()
    const status = createMockStatus()

    handleUpsertStatus(
      db,
      JSON.stringify(status),
      'https://example.com',
      'home',
    )

    // BEGIN と COMMIT が発行されること
    expect(calls[0].sql).toContain('BEGIN')
    expect(calls[calls.length - 1].sql).toContain('COMMIT')
  })

  it('extractPostColumns を使用する（extractStatusColumns ではない）', () => {
    const { db } = createMockDb()
    const status = createMockStatus()

    handleUpsertStatus(
      db,
      JSON.stringify(status),
      'https://example.com',
      'home',
    )

    expect(helpersModule.extractPostColumns).toHaveBeenCalled()
  })
})

// ================================================================
// handleBulkUpsertStatuses
// ================================================================

describe('handleBulkUpsertStatuses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(statusHelpersModule.resolvePostIdInternal).mockReturnValue(
      undefined,
    )
    vi.mocked(statusHelpersModule.getLastInsertRowId).mockReturnValue(999)
    vi.mocked(helpersModule.resolveLocalAccountId).mockReturnValue(100)
    vi.mocked(helpersModule.ensureServer).mockReturnValue(1)
    vi.mocked(helpersModule.ensureProfile).mockReturnValue(10)
    vi.mocked(statusHelpersModule.resolveVisibilityId).mockReturnValue(1)
  })

  it('複数の投稿を一括保存する', () => {
    const { db, calls } = createMockDb()
    const statuses = [
      createMockStatus({ id: '1', uri: 'https://example.com/statuses/1' }),
      createMockStatus({ id: '2', uri: 'https://example.com/statuses/2' }),
      createMockStatus({ id: '3', uri: 'https://example.com/statuses/3' }),
    ]

    handleBulkUpsertStatuses(
      db,
      statuses.map((s) => JSON.stringify(s)),
      'https://example.com',
      'home',
    )

    // 3 件の INSERT INTO posts が発行されていること
    const postInserts = calls.filter(
      (c) =>
        c.sql.includes('INSERT INTO posts') &&
        !c.sql.includes('post_backend_ids') &&
        !c.sql.includes('post_hashtags') &&
        !c.sql.includes('post_custom_emojis'),
    )
    expect(postInserts).toHaveLength(3)
  })

  it('トランザクション内で処理する', () => {
    const { db, calls } = createMockDb()
    const statuses = [
      createMockStatus({ id: '1', uri: 'https://example.com/statuses/1' }),
      createMockStatus({ id: '2', uri: 'https://example.com/statuses/2' }),
    ]

    handleBulkUpsertStatuses(
      db,
      statuses.map((s) => JSON.stringify(s)),
      'https://example.com',
      'home',
    )

    // BEGIN は 1 回のみ（ループの外）
    const beginCalls = calls.filter((c) => c.sql.includes('BEGIN'))
    expect(beginCalls).toHaveLength(1)

    // COMMIT は 1 回のみ（ループの外）
    const commitCalls = calls.filter((c) => c.sql.includes('COMMIT'))
    expect(commitCalls).toHaveLength(1)

    // BEGIN が最初で COMMIT が最後
    expect(calls[0].sql).toContain('BEGIN')
    expect(calls[calls.length - 1].sql).toContain('COMMIT')
  })

  it('posts_backends / posts_reblogs テーブルを使用しない', () => {
    const { db, calls } = createMockDb()
    const statuses = [
      createMockStatus({ id: '1', uri: 'https://example.com/statuses/1' }),
    ]

    handleBulkUpsertStatuses(
      db,
      statuses.map((s) => JSON.stringify(s)),
      'https://example.com',
      'home',
    )

    const oldTableCalls = calls.filter(
      (c) =>
        c.sql.includes('posts_backends') || c.sql.includes('posts_reblogs'),
    )
    expect(oldTableCalls).toHaveLength(0)
  })

  it('post_backend_ids にエントリを追加する', () => {
    const { db, calls } = createMockDb()
    const statuses = [
      createMockStatus({ id: '1', uri: 'https://example.com/statuses/1' }),
      createMockStatus({ id: '2', uri: 'https://example.com/statuses/2' }),
    ]

    handleBulkUpsertStatuses(
      db,
      statuses.map((s) => JSON.stringify(s)),
      'https://example.com',
      'home',
    )

    const backendIdInserts = calls.filter(
      (c) => c.sql.includes('INSERT') && c.sql.includes('post_backend_ids'),
    )
    expect(backendIdInserts).toHaveLength(2)

    // local_account_id が含まれること
    for (const insert of backendIdInserts) {
      expect(insert.sql).toContain('local_account_id')
    }
  })

  it('timeline_entries にエントリを追加する', () => {
    const { db, calls } = createMockDb()
    const statuses = [
      createMockStatus({ id: '1', uri: 'https://example.com/statuses/1' }),
      createMockStatus({ id: '2', uri: 'https://example.com/statuses/2' }),
    ]

    handleBulkUpsertStatuses(
      db,
      statuses.map((s) => JSON.stringify(s)),
      'https://example.com',
      'home',
    )

    const timelineInserts = calls.filter(
      (c) => c.sql.includes('INSERT') && c.sql.includes('timeline_entries'),
    )
    expect(timelineInserts).toHaveLength(2)

    // timeline_items を使用しないこと
    const oldTimelineCalls = calls.filter((c) =>
      c.sql.includes('timeline_items'),
    )
    expect(oldTimelineCalls).toHaveLength(0)
  })

  it('updateInteraction を使用する（toggleEngagement ではない）', () => {
    const { db } = createMockDb()
    const statuses = [
      createMockStatus({
        favourited: true,
        id: '1',
        uri: 'https://example.com/statuses/1',
      }),
    ]

    handleBulkUpsertStatuses(
      db,
      statuses.map((s) => JSON.stringify(s)),
      'https://example.com',
      'home',
    )

    expect(helpersModule.updateInteraction).toHaveBeenCalledWith(
      db,
      999,
      100,
      'favourite',
      true,
    )
  })

  it('空配列の場合は何も処理しない', () => {
    const { db, calls } = createMockDb()

    const result = handleBulkUpsertStatuses(
      db,
      [],
      'https://example.com',
      'home',
    )

    expect(result.changedTables).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })

  it('ensureServer を一度だけ呼び出す（ループ外）', () => {
    const { db } = createMockDb()
    const statuses = [
      createMockStatus({ id: '1', uri: 'https://example.com/statuses/1' }),
      createMockStatus({ id: '2', uri: 'https://example.com/statuses/2' }),
      createMockStatus({ id: '3', uri: 'https://example.com/statuses/3' }),
    ]

    handleBulkUpsertStatuses(
      db,
      statuses.map((s) => JSON.stringify(s)),
      'https://example.com',
      'home',
    )

    expect(helpersModule.ensureServer).toHaveBeenCalledTimes(1)
  })

  it('resolveDelayedReplyReferences / resolveDelayedRepostReferences を呼び出さない', () => {
    const { db, calls } = createMockDb()
    const statuses = [
      createMockStatus({ id: '1', uri: 'https://example.com/statuses/1' }),
    ]

    handleBulkUpsertStatuses(
      db,
      statuses.map((s) => JSON.stringify(s)),
      'https://example.com',
      'home',
    )

    // delayed reference SQL パターンがないこと
    const delayedCalls = calls.filter(
      (c) =>
        c.sql.toLowerCase().includes('delayed') ||
        (c.sql.includes('UPDATE posts') &&
          c.sql.includes('reply_to_post_id') &&
          c.sql.includes('WHERE') &&
          c.sql.includes('in_reply_to_id')),
    )
    expect(delayedCalls).toHaveLength(0)
  })
})
