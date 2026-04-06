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
  buildTimelineKey: vi.fn((type: string) => type),
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
const { handleUpdateStatus } = await import(
  'util/db/sqlite/worker/handlers/statusUpdateHandler'
)

// ================================================================
// handleUpdateStatus
// ================================================================

describe('handleUpdateStatus', () => {
  /**
   * handleUpdateStatus は URI → post_backend_ids の順で既存投稿を検索する。
   * テスト用に、URI 検索で postId=42 を返すモック DB を作成する。
   */
  function createDbWithExistingPost() {
    return createMockDb((sql, opts) => {
      // SELECT id FROM posts WHERE object_uri = ?
      if (
        sql.includes('SELECT') &&
        sql.includes('FROM posts') &&
        sql.includes('object_uri')
      ) {
        return [[42]]
      }
      // SELECT id FROM posts WHERE id = ?  (存在確認)
      if (
        sql.includes('SELECT') &&
        sql.includes('FROM posts') &&
        sql.includes('WHERE id')
      ) {
        return [[42]]
      }
      if (opts?.returnValue === 'resultRows') return []
      return undefined
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(statusHelpersModule.resolvePostIdInternal).mockReturnValue(
      undefined,
    )
    vi.mocked(helpersModule.resolveLocalAccountId).mockReturnValue(100)
    vi.mocked(helpersModule.ensureServer).mockReturnValue(1)
    vi.mocked(helpersModule.ensureProfile).mockReturnValue(10)
    vi.mocked(statusHelpersModule.resolveVisibilityId).mockReturnValue(1)
  })

  it('既存投稿を更新する', () => {
    const { db, calls } = createDbWithExistingPost()
    const status = createMockStatus()

    const result = handleUpdateStatus(
      db,
      JSON.stringify(status),
      'https://example.com',
    )

    expect(result.changedTables).toContain('posts')

    // UPDATE posts SET が発行されていること
    const updateCalls = calls.filter((c) => c.sql.includes('UPDATE posts SET'))
    expect(updateCalls.length).toBeGreaterThanOrEqual(1)

    // WHERE id = ? であること（post_id ではない）
    const updateSql = updateCalls[0].sql
    expect(updateSql).toMatch(/WHERE\s+id\s*=/)
    expect(updateSql).not.toMatch(/WHERE\s+post_id\s*=/)
  })

  it('新カラム（edited_at_ms等）を更新する', () => {
    // edited_at_ms を返すように extractPostColumns をモック
    vi.mocked(helpersModule.extractPostColumns).mockReturnValue({
      application_name: 'TestApp',
      canonical_url: 'https://example.com/@alice/12345',
      content_html: '<p>Edited content</p>',
      created_at_ms: 1718451000000,
      edited_at_ms: 1718460000000,
      in_reply_to_account_acct: 'bob@remote.example',
      in_reply_to_uri: 'reply-target-1',
      is_local_only: 0,
      is_sensitive: 1,
      language: 'en',
      object_uri: 'https://example.com/users/alice/statuses/12345',
      plain_content: 'Edited content',
      quote_state: 'accepted',
      spoiler_text: 'CW',
      visibility_id: 1,
    })

    const { db, calls } = createDbWithExistingPost()
    const status = createMockStatus({
      edited_at: '2024-06-16T00:00:00.000Z',
    })

    handleUpdateStatus(db, JSON.stringify(status), 'https://example.com')

    const updateCalls = calls.filter((c) => c.sql.includes('UPDATE posts SET'))
    expect(updateCalls.length).toBeGreaterThanOrEqual(1)
    const updateSql = updateCalls[0].sql

    // 新スキーマのカラムが含まれること
    expect(updateSql).toContain('last_fetched_at')
    expect(updateSql).toContain('edited_at_ms')
    expect(updateSql).toContain('plain_content')
    expect(updateSql).toContain('in_reply_to_uri')
    expect(updateSql).toContain('in_reply_to_account_acct')
    expect(updateSql).toContain('quote_state')
    expect(updateSql).toContain('is_local_only')
    expect(updateSql).toContain('application_name')
    expect(updateSql).toContain('reblog_of_post_id')
    expect(updateSql).toContain('quote_of_post_id')

    // 旧スキーマのカラムが含まれないこと
    expect(updateSql).not.toContain('stored_at')
    expect(updateSql).not.toContain('has_media')
    expect(updateSql).not.toContain('media_count')
    expect(updateSql).not.toContain('has_spoiler')
    expect(updateSql).not.toContain('reblog_of_uri')

    // bind に新カラムの値が含まれること
    const bind = updateCalls[0].opts?.bind as (string | number | null)[]
    expect(bind).toContain(1718460000000) // edited_at_ms
    expect(bind).toContain('Edited content') // plain_content
    expect(bind).toContain('bob@remote.example') // in_reply_to_account_acct
    expect(bind).toContain('TestApp') // application_name
    expect(bind).toContain('accepted') // quote_state
  })

  it('updateInteraction を使用する（toggleEngagement ではない）', () => {
    const { db } = createDbWithExistingPost()
    const status = createMockStatus({
      bookmarked: true,
      favourited: true,
      reblogged: true,
    })

    handleUpdateStatus(db, JSON.stringify(status), 'https://example.com')

    // updateInteraction が 3 回呼ばれること
    expect(helpersModule.updateInteraction).toHaveBeenCalledWith(
      db,
      42,
      100,
      'favourite',
      true,
      expect.anything(),
    )
    expect(helpersModule.updateInteraction).toHaveBeenCalledWith(
      db,
      42,
      100,
      'reblog',
      true,
      expect.anything(),
    )
    expect(helpersModule.updateInteraction).toHaveBeenCalledWith(
      db,
      42,
      100,
      'bookmark',
      true,
      expect.anything(),
    )
  })

  it('インタラクションが false の場合も updateInteraction を呼び出す', () => {
    const { db } = createDbWithExistingPost()
    const status = createMockStatus({
      bookmarked: false,
      favourited: false,
      reblogged: false,
    })

    handleUpdateStatus(db, JSON.stringify(status), 'https://example.com')

    expect(helpersModule.updateInteraction).toHaveBeenCalledWith(
      db,
      42,
      100,
      'favourite',
      false,
      expect.anything(),
    )
    expect(helpersModule.updateInteraction).toHaveBeenCalledWith(
      db,
      42,
      100,
      'reblog',
      false,
      expect.anything(),
    )
    expect(helpersModule.updateInteraction).toHaveBeenCalledWith(
      db,
      42,
      100,
      'bookmark',
      false,
      expect.anything(),
    )
  })

  it('ensureProfileAlias を呼び出さない', () => {
    const { db, calls } = createDbWithExistingPost()
    const status = createMockStatus()

    handleUpdateStatus(db, JSON.stringify(status), 'https://example.com')

    // profile_aliases テーブルへの参照がないこと
    const aliasCalls = calls.filter((c) => c.sql.includes('profile_aliases'))
    expect(aliasCalls).toHaveLength(0)
  })

  it('ensureServer を host で呼び出す（backendUrl ではない）', () => {
    const { db } = createDbWithExistingPost()
    const status = createMockStatus()

    handleUpdateStatus(db, JSON.stringify(status), 'https://example.com')

    // ensureServer が host ('example.com') で呼ばれること
    expect(helpersModule.ensureServer).toHaveBeenCalledWith(
      db,
      'example.com',
      expect.anything(),
    )
  })

  it('ensureProfile を新シグネチャ (db, account, serverId) で呼び出す', () => {
    const { db } = createDbWithExistingPost()
    const status = createMockStatus()

    handleUpdateStatus(db, JSON.stringify(status), 'https://example.com')

    const callArgs = vi.mocked(helpersModule.ensureProfile).mock.calls[0]
    expect(callArgs).toHaveLength(4)
    expect(callArgs[0]).toBe(db)
    expect(callArgs[1]).toEqual(
      expect.objectContaining({ acct: 'alice@example.com' }),
    )
    expect(callArgs[2]).toBe(1) // serverId
  })

  it('投稿が見つからない場合は空の changedTables を返す', () => {
    // 全ての SELECT が空を返す
    const { db } = createMockDb()
    const status = createMockStatus()

    const result = handleUpdateStatus(
      db,
      JSON.stringify(status),
      'https://example.com',
    )

    expect(result.changedTables).toHaveLength(0)
  })

  it('URI が空の場合 post_backend_ids で検索する', () => {
    vi.mocked(statusHelpersModule.resolvePostIdInternal).mockReturnValue(42)

    const { db, calls: _calls } = createMockDb((sql, opts) => {
      // SELECT id FROM posts WHERE id = ? (存在確認)
      if (
        sql.includes('SELECT') &&
        sql.includes('FROM posts') &&
        sql.includes('WHERE id')
      ) {
        return [[42]]
      }
      if (opts?.returnValue === 'resultRows') return []
      return undefined
    })

    const status = createMockStatus({ uri: '' })

    handleUpdateStatus(db, JSON.stringify(status), 'https://example.com')

    // resolvePostIdInternal が呼ばれたこと
    expect(statusHelpersModule.resolvePostIdInternal).toHaveBeenCalledWith(
      db,
      100,
      '12345',
    )
  })

  it('resolvePostIdInternal を新シグネチャ (db, localAccountId, localId) で呼び出す', () => {
    // URI では見つからないが post_backend_ids で見つかるケース
    vi.mocked(statusHelpersModule.resolvePostIdInternal).mockReturnValue(55)

    const { db } = createMockDb((sql, opts) => {
      // URI 検索は空
      if (sql.includes('object_uri')) return []
      // 存在確認で見つかる
      if (
        sql.includes('SELECT') &&
        sql.includes('FROM posts') &&
        sql.includes('WHERE id')
      ) {
        return [[55]]
      }
      if (opts?.returnValue === 'resultRows') return []
      return undefined
    })
    const status = createMockStatus()

    handleUpdateStatus(db, JSON.stringify(status), 'https://example.com')

    // resolvePostIdInternal が (db, localAccountId=100, localId='12345') で呼ばれること
    expect(statusHelpersModule.resolvePostIdInternal).toHaveBeenCalledWith(
      db,
      100,
      '12345',
    )
  })

  it('extractPostColumns を使用する（extractStatusColumns ではない）', () => {
    const { db } = createDbWithExistingPost()
    const status = createMockStatus()

    handleUpdateStatus(db, JSON.stringify(status), 'https://example.com')

    expect(helpersModule.extractPostColumns).toHaveBeenCalled()
  })

  it('posts PK が id であること（post_id ではない）', () => {
    const { db, calls } = createDbWithExistingPost()
    const status = createMockStatus()

    handleUpdateStatus(db, JSON.stringify(status), 'https://example.com')

    // SELECT で posts.id を参照していること
    const selectCalls = calls.filter(
      (c) => c.sql.includes('SELECT') && c.sql.includes('FROM posts'),
    )
    for (const sel of selectCalls) {
      // post_id を WHERE で使っていないこと
      expect(sel.sql).not.toMatch(/WHERE\s+post_id\s*=/)
    }
  })

  it('upsertMentionsInternal を serverId なしで呼び出す', () => {
    const { db } = createDbWithExistingPost()
    const status = createMockStatus()

    handleUpdateStatus(db, JSON.stringify(status), 'https://example.com')

    const mentionCalls = vi.mocked(postSyncModule.upsertMentionsInternal).mock
      .calls
    expect(mentionCalls.length).toBe(1)
    expect(mentionCalls[0]).toHaveLength(4) // (db, postId, mentions, collector)
  })

  it('syncPostMedia を sensitive 引数なしで呼び出す', () => {
    const { db } = createDbWithExistingPost()
    const status = createMockStatus()

    handleUpdateStatus(db, JSON.stringify(status), 'https://example.com')

    const mediaCalls = vi.mocked(postSyncModule.syncPostMedia).mock.calls
    expect(mediaCalls.length).toBe(1)
    expect(mediaCalls[0]).toHaveLength(4) // (db, postId, mediaAttachments, collector)
  })

  it('リブログの場合、元投稿も更新する', () => {
    const originalStatus = createMockStatus({
      id: 'original-1',
      uri: 'https://example.com/users/bob/statuses/99999',
    })
    const reblogStatus = createMockStatus({
      id: '12345',
      reblog: originalStatus,
      uri: 'https://example.com/users/alice/statuses/12345',
    })

    const { db } = createDbWithExistingPost()

    handleUpdateStatus(db, JSON.stringify(reblogStatus), 'https://example.com')

    // ensureReblogOriginalPost が呼ばれたこと
    expect(postSyncModule.ensureReblogOriginalPost).toHaveBeenCalled()
  })

  it('トランザクション内で処理する', () => {
    const { db, calls } = createDbWithExistingPost()
    const status = createMockStatus()

    handleUpdateStatus(db, JSON.stringify(status), 'https://example.com')

    // トランザクション内の呼び出しのみチェック（最初の SELECT は外）
    const beginCalls = calls.filter((c) => c.sql.includes('BEGIN'))
    const commitCalls = calls.filter((c) => c.sql.includes('COMMIT'))
    expect(beginCalls).toHaveLength(1)
    expect(commitCalls).toHaveLength(1)
  })

  it('posts_reblogs テーブルを使用しない', () => {
    const originalStatus = createMockStatus({
      id: 'original-1',
      uri: 'https://example.com/users/bob/statuses/99999',
    })
    const reblogStatus = createMockStatus({
      id: '12345',
      reblog: originalStatus,
      uri: 'https://example.com/users/alice/statuses/12345',
    })

    const { db, calls } = createDbWithExistingPost()

    handleUpdateStatus(db, JSON.stringify(reblogStatus), 'https://example.com')

    const reblogTableCalls = calls.filter((c) =>
      c.sql.includes('posts_reblogs'),
    )
    expect(reblogTableCalls).toHaveLength(0)
  })

  it('posts_backends テーブルを使用しない', () => {
    const { db, calls } = createDbWithExistingPost()
    const status = createMockStatus()

    handleUpdateStatus(db, JSON.stringify(status), 'https://example.com')

    const backendsCalls = calls.filter((c) => c.sql.includes('posts_backends'))
    expect(backendsCalls).toHaveLength(0)
  })
})
