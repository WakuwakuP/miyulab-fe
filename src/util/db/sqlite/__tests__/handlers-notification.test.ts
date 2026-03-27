import {
  ensureProfile,
  ensureServer,
  resolveLocalAccountId,
  resolvePostId,
  syncPollData,
  updateInteraction,
} from 'util/db/sqlite/helpers'
import type { DbExecCompat } from 'util/db/sqlite/helpers/types'
import {
  handleAddNotification,
  handleBulkAddNotifications,
  handleUpdateNotificationStatusAction,
  resolveNotificationTypeId,
  upsertNotification,
} from 'util/db/sqlite/worker/workerNotificationStore'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── モジュールモック ───────────────────────────────────────────

vi.mock('util/db/sqlite/helpers', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('util/db/sqlite/helpers')>()
  return {
    ...original,
    ensureProfile: vi.fn().mockReturnValue(10),
    ensureServer: vi.fn().mockReturnValue(1),
    extractPostColumns: vi.fn().mockReturnValue({
      application_name: null,
      canonical_url: 'https://example.com/@user/1',
      content_html: '<p>Hello</p>',
      created_at_ms: 1700000000000,
      edited_at_ms: null,
      in_reply_to_account_acct: null,
      in_reply_to_uri: null,
      is_local_only: 0,
      is_sensitive: 0,
      language: 'ja',
      object_uri: 'https://example.com/notes/1',
      plain_content: null,
      quote_state: null,
      spoiler_text: '',
      visibility_id: 1,
    }),
    resolveLocalAccountId: vi.fn().mockReturnValue(42),
    resolvePostId: vi.fn().mockReturnValue(undefined),
    syncPollData: vi.fn(),
    syncPostCustomEmojis: vi.fn(),
    syncProfileCustomEmojis: vi.fn(),
    updateInteraction: vi.fn(),
  }
})

// ─── 型 ─────────────────────────────────────────────────────────

type ExecCall = { sql: string; opts?: Parameters<DbExecCompat['exec']>[1] }

// ─── Mock DB factory ────────────────────────────────────────────

/**
 * SQL パターンに基づいて異なる結果を返す Mock DB を作成する。
 * queryMap: SQL の部分文字列 → 返すべき resultRows のリスト（呼び出し順）
 */
function createMockDb(queryMap: Record<string, unknown[][][]> = {}): {
  db: DbExecCompat
  calls: ExecCall[]
} {
  const calls: ExecCall[] = []
  const counters: Record<string, number> = {}

  const db: DbExecCompat = {
    exec: vi.fn((sql: string, opts?: Parameters<DbExecCompat['exec']>[1]) => {
      calls.push({ opts, sql })

      if (opts?.returnValue === 'resultRows') {
        for (const pattern of Object.keys(queryMap)) {
          if (sql.includes(pattern)) {
            const idx = counters[pattern] ?? 0
            counters[pattern] = idx + 1
            const results = queryMap[pattern]
            return results[idx] ?? []
          }
        }
        return []
      }
      return undefined
    }),
  }

  return { calls, db }
}

// ─── ヘルパー: テスト用通知エンティティ ─────────────────────────

function makeNotification(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    account: {
      acct: 'actor@example.com',
      avatar: '',
      avatar_static: '',
      bot: false,
      display_name: 'Actor',
      emojis: [],
      header: '',
      header_static: '',
      id: 'actor-1',
      locked: false,
      note: '',
      url: 'https://example.com/@actor',
      username: 'actor',
    },
    created_at: '2024-01-15T10:00:00.000Z',
    id: 'notif-1',
    reaction: null,
    status: null,
    type: 'favourite',
    ...overrides,
  }
}

function makeStatus(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    account: {
      acct: 'author@example.com',
      avatar: '',
      avatar_static: '',
      bot: false,
      display_name: 'Author',
      emojis: [],
      header: '',
      header_static: '',
      id: 'author-1',
      locked: false,
      note: '',
      url: 'https://example.com/@author',
      username: 'author',
    },
    content: '<p>Hello</p>',
    created_at: '2024-01-15T09:00:00.000Z',
    emojis: [],
    id: 'status-1',
    in_reply_to_id: null,
    language: 'ja',
    mentions: [],
    poll: null,
    reblog: null,
    sensitive: false,
    spoiler_text: '',
    uri: 'https://example.com/notes/1',
    url: 'https://example.com/@user/1',
    visibility: 'public',
    ...overrides,
  }
}

// ─── セットアップ ───────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  // デフォルトモック値を再設定
  vi.mocked(ensureServer).mockReturnValue(1)
  vi.mocked(ensureProfile).mockReturnValue(10)
  vi.mocked(resolveLocalAccountId).mockReturnValue(42)
  vi.mocked(resolvePostId).mockReturnValue(undefined)
})

// ================================================================
// resolveNotificationTypeId
// ================================================================

describe('resolveNotificationTypeId', () => {
  it('notification type 名から ID を解決する', () => {
    const { db } = createMockDb()

    expect(resolveNotificationTypeId(db, 'follow')).toBe(1)
    expect(resolveNotificationTypeId(db, 'favourite')).toBe(2)
    expect(resolveNotificationTypeId(db, 'reblog')).toBe(3)
    expect(resolveNotificationTypeId(db, 'mention')).toBe(4)
    expect(resolveNotificationTypeId(db, 'reaction')).toBe(5)
    expect(resolveNotificationTypeId(db, 'follow_request')).toBe(6)
    expect(resolveNotificationTypeId(db, 'status')).toBe(7)
    expect(resolveNotificationTypeId(db, 'poll_vote')).toBe(8)
    expect(resolveNotificationTypeId(db, 'poll_expired')).toBe(9)
    expect(resolveNotificationTypeId(db, 'update')).toBe(10)
    expect(resolveNotificationTypeId(db, 'move')).toBe(11)
    expect(resolveNotificationTypeId(db, 'admin_signup')).toBe(12)
    expect(resolveNotificationTypeId(db, 'admin_report')).toBe(13)
    expect(resolveNotificationTypeId(db, 'follow_request_accepted')).toBe(14)
    expect(resolveNotificationTypeId(db, 'login_bonus')).toBe(100)
    expect(resolveNotificationTypeId(db, 'create_token')).toBe(101)
    expect(resolveNotificationTypeId(db, 'export_completed')).toBe(102)
    expect(resolveNotificationTypeId(db, 'login')).toBe(103)
    expect(resolveNotificationTypeId(db, 'unknown')).toBe(199)
  })

  it('不明な type 名の場合 199 (unknown) を返す', () => {
    const { db } = createMockDb()

    expect(resolveNotificationTypeId(db, 'nonexistent_type')).toBe(199)
    expect(resolveNotificationTypeId(db, '')).toBe(199)
    expect(resolveNotificationTypeId(db, 'some_future_type')).toBe(199)
  })
})

// ================================================================
// upsertNotification
// ================================================================

describe('upsertNotification', () => {
  it('通知をDBに保存する', () => {
    const { db, calls } = createMockDb({
      // last_insert_rowid
      last_insert_rowid: [[[99]]],
    })

    const notification = makeNotification()

    const result = upsertNotification(
      db,
      notification as never,
      'https://example.com',
    )

    expect(typeof result).toBe('boolean')

    // INSERT INTO notifications が実行される
    const insertCall = calls.find((c) =>
      c.sql.includes('INSERT INTO notifications'),
    )
    expect(insertCall).toBeDefined()
    expect(insertCall!.sql).toContain('local_account_id')
    expect(insertCall!.sql).toContain('local_id')
    expect(insertCall!.sql).toContain('notification_type_id')
    expect(insertCall!.sql).toContain('created_at_ms')
    expect(insertCall!.sql).toContain('actor_profile_id')
    expect(insertCall!.sql).toContain('reaction_name')
    expect(insertCall!.sql).toContain('reaction_url')
    expect(insertCall!.sql).toContain('is_read')
    expect(insertCall!.sql).toContain('ON CONFLICT(local_account_id, local_id)')

    // bind に local_account_id が含まれる
    const bind = insertCall!.opts?.bind as (string | number | null)[]
    expect(bind).toContain(42) // local_account_id from resolveLocalAccountId
    expect(bind).toContain('notif-1') // local_id
    expect(bind).toContain(2) // notification_type_id for 'favourite'
  })

  it('(local_account_id, local_id) でデデュプする', () => {
    const { db, calls } = createMockDb()

    const notification = makeNotification()

    upsertNotification(db, notification as never, 'https://example.com')

    // UPSERT SQL を確認: ON CONFLICT(local_account_id, local_id) DO UPDATE
    const insertCall = calls.find((c) =>
      c.sql.includes('INSERT INTO notifications'),
    )
    expect(insertCall).toBeDefined()
    expect(insertCall!.sql).toContain('ON CONFLICT(local_account_id, local_id)')
    expect(insertCall!.sql).toContain('DO UPDATE SET')

    // server_id を使った重複チェック SELECT が存在しないことを確認
    const serverIdCheck = calls.find(
      (c) =>
        c.sql.includes('SELECT') &&
        c.sql.includes('notifications') &&
        c.sql.includes('server_id'),
    )
    expect(serverIdCheck).toBeUndefined()
  })

  it('server_id を使用しない', () => {
    const { db, calls } = createMockDb()

    const notification = makeNotification()

    upsertNotification(db, notification as never, 'https://example.com')

    // INSERT SQL に server_id が含まれないことを確認
    const insertCall = calls.find((c) =>
      c.sql.includes('INSERT INTO notifications'),
    )
    expect(insertCall).toBeDefined()

    // INSERT の VALUES 部分に server_id カラムが含まれていない
    // stored_at も含まれていない
    const sqlBeforeValues = insertCall!.sql.split('VALUES')[0]
    expect(sqlBeforeValues).not.toContain('server_id')
    expect(sqlBeforeValues).not.toContain('stored_at')
  })

  it('reaction_name, reaction_url を保存する', () => {
    const { db, calls } = createMockDb()

    const notification = makeNotification({
      reaction: {
        name: ':blobcat:',
        static_url: 'https://example.com/emoji/blobcat_static.png',
        url: 'https://example.com/emoji/blobcat.png',
      },
      type: 'reaction',
    })
    upsertNotification(db, notification as never, 'https://example.com')

    const insertCall = calls.find((c) =>
      c.sql.includes('INSERT INTO notifications'),
    )
    expect(insertCall).toBeDefined()

    const bind = insertCall!.opts?.bind as (string | number | null)[]
    expect(bind).toContain(':blobcat:')
    expect(bind).toContain('https://example.com/emoji/blobcat.png')
  })
})

// ================================================================
// handleAddNotification
// ================================================================

describe('handleAddNotification', () => {
  it('通知を追加する', () => {
    const { db } = createMockDb()

    const notification = makeNotification()
    const notificationJson = JSON.stringify(notification)

    const result = handleAddNotification(
      db,
      notificationJson,
      'https://example.com',
    )

    expect(result).toEqual({ changedTables: ['notifications'] })

    // ensureServer が host で呼ばれる
    expect(ensureServer).toHaveBeenCalledWith(db, 'example.com')

    // resolveLocalAccountId が呼ばれる
    expect(resolveLocalAccountId).toHaveBeenCalledWith(
      db,
      'https://example.com',
    )
  })

  it('関連投稿がある場合は先に保存する', () => {
    // resolvePostId が undefined を返すので新規投稿として挿入される
    vi.mocked(resolvePostId).mockReturnValue(undefined)

    const { db, calls } = createMockDb({
      // last_insert_rowid for post
      last_insert_rowid: [[[50]]],
      // posts の object_uri チェック → 見つからない
      'SELECT id FROM posts WHERE object_uri': [[]],
    })

    const status = makeStatus()
    const notification = makeNotification({
      status,
      type: 'favourite',
    })
    const notificationJson = JSON.stringify(notification)

    const result = handleAddNotification(
      db,
      notificationJson,
      'https://example.com',
    )

    expect(result).toBeDefined()

    // 投稿の INSERT が通知の INSERT より先に発行される
    const postInsertIdx = calls.findIndex((c) =>
      c.sql.includes('INSERT INTO posts'),
    )
    const notifInsertIdx = calls.findIndex((c) =>
      c.sql.includes('INSERT INTO notifications'),
    )
    // 両方が発行されている
    expect(postInsertIdx).toBeGreaterThan(-1)
    expect(notifInsertIdx).toBeGreaterThan(-1)
    // 投稿が先
    expect(postInsertIdx).toBeLessThan(notifInsertIdx)

    // post_backend_ids に投稿がマッピングされる
    const backendIdInsert = calls.find(
      (c) => c.sql.includes('INSERT') && c.sql.includes('post_backend_ids'),
    )
    expect(backendIdInsert).toBeDefined()

    // ensureProfile が投稿の author に対しても呼ばれる (serverId 付き)
    expect(ensureProfile).toHaveBeenCalled()
  })

  it('関連投稿が既存の場合は新規挿入しない', () => {
    // resolvePostId が既存の post_id を返す
    vi.mocked(resolvePostId).mockReturnValue(50)

    const { db, calls } = createMockDb()

    const status = makeStatus()
    const notification = makeNotification({
      status,
      type: 'favourite',
    })
    const notificationJson = JSON.stringify(notification)

    handleAddNotification(db, notificationJson, 'https://example.com')

    // posts への INSERT は発行されない
    const postInsert = calls.find((c) => c.sql.includes('INSERT INTO posts'))
    expect(postInsert).toBeUndefined()
  })

  it('関連投稿に poll がある場合は posts を変更テーブルに含める', () => {
    vi.mocked(resolvePostId).mockReturnValue(50)

    const { db } = createMockDb()

    const status = makeStatus({
      poll: {
        expired: false,
        expires_at: '2024-02-01T00:00:00.000Z',
        id: 'poll-1',
        multiple: false,
        options: [{ title: 'A', votes_count: 5 }],
        votes_count: 10,
      },
    })
    const notification = makeNotification({
      status,
      type: 'poll_expired',
    })
    const notificationJson = JSON.stringify(notification)

    const result = handleAddNotification(
      db,
      notificationJson,
      'https://example.com',
    )

    expect(result.changedTables).toContain('posts')
    expect(syncPollData).toHaveBeenCalled()
  })
})

// ================================================================
// handleBulkAddNotifications
// ================================================================

describe('handleBulkAddNotifications', () => {
  it('複数の通知を一括追加する', () => {
    const { db, calls } = createMockDb()

    const notifications = [
      makeNotification({ id: 'notif-1', type: 'favourite' }),
      makeNotification({ id: 'notif-2', type: 'reblog' }),
      makeNotification({ id: 'notif-3', type: 'follow' }),
    ]
    const notificationsJson = notifications.map((n) => JSON.stringify(n))

    const result = handleBulkAddNotifications(
      db,
      notificationsJson,
      'https://example.com',
    )

    expect(result).toEqual({ changedTables: ['notifications'] })

    // BEGIN + COMMIT が呼ばれる
    expect(calls[0].sql).toBe('BEGIN;')
    expect(calls[calls.length - 1].sql).toBe('COMMIT;')

    // 3件の通知 INSERT が発行される
    const notifInserts = calls.filter((c) =>
      c.sql.includes('INSERT INTO notifications'),
    )
    expect(notifInserts).toHaveLength(3)

    // ensureServer が host で呼ばれる（内部キャッシュにより実質1回だが、
    // upsertNotification 内でも呼ばれるため回数ではなく引数を検証）
    expect(ensureServer).toHaveBeenCalledWith(db, 'example.com')
  })

  it('空のリストの場合は何もしない', () => {
    const { db, calls } = createMockDb()

    const result = handleBulkAddNotifications(db, [], 'https://example.com')

    expect(result).toEqual({ changedTables: [] })
    expect(calls).toHaveLength(0)
  })

  it('エラー時にROLLBACKする', () => {
    // ensureServer がモック済みなので DB 呼び出しは通知の INSERT 時に失敗させる
    const calls: ExecCall[] = []
    let insertCount = 0
    const db: DbExecCompat = {
      exec: vi.fn((sql: string, opts?: Parameters<DbExecCompat['exec']>[1]) => {
        calls.push({ opts, sql })
        if (sql.includes('INSERT INTO notifications')) {
          insertCount++
          if (insertCount >= 2) {
            throw new Error('DB error')
          }
        }
        if (opts?.returnValue === 'resultRows') {
          return []
        }
        return undefined
      }),
    }

    const notifications = [
      makeNotification({ id: 'notif-1', type: 'favourite' }),
      makeNotification({ id: 'notif-2', type: 'reblog' }),
    ]
    const notificationsJson = notifications.map((n) => JSON.stringify(n))

    expect(() =>
      handleBulkAddNotifications(db, notificationsJson, 'https://example.com'),
    ).toThrow('DB error')

    const rollback = calls.find((c) => c.sql === 'ROLLBACK;')
    expect(rollback).toBeDefined()
  })
})

// ================================================================
// handleUpdateNotificationStatusAction
// ================================================================

describe('handleUpdateNotificationStatusAction', () => {
  it('updateInteraction を呼び出す', () => {
    vi.mocked(resolvePostId).mockReturnValue(100)

    const { db } = createMockDb()

    const result = handleUpdateNotificationStatusAction(
      db,
      'https://example.com',
      'status-123',
      'favourited',
      true,
    )

    expect(resolvePostId).toHaveBeenCalledWith(
      db,
      'https://example.com',
      'status-123',
    )
    expect(resolveLocalAccountId).toHaveBeenCalledWith(
      db,
      'https://example.com',
    )
    expect(updateInteraction).toHaveBeenCalledWith(
      db,
      100,
      42,
      'favourite',
      true,
    )
    expect(result).toEqual({ changedTables: ['notifications'] })
  })

  it('reblogged アクションを処理する', () => {
    vi.mocked(resolvePostId).mockReturnValue(200)

    const { db } = createMockDb()

    const result = handleUpdateNotificationStatusAction(
      db,
      'https://example.com',
      'status-456',
      'reblogged',
      true,
    )

    expect(updateInteraction).toHaveBeenCalledWith(db, 200, 42, 'reblog', true)
    expect(result).toEqual({ changedTables: ['notifications'] })
  })

  it('bookmarked アクションを処理する', () => {
    vi.mocked(resolvePostId).mockReturnValue(300)

    const { db } = createMockDb()

    const result = handleUpdateNotificationStatusAction(
      db,
      'https://example.com',
      'status-789',
      'bookmarked',
      false,
    )

    expect(updateInteraction).toHaveBeenCalledWith(
      db,
      300,
      42,
      'bookmark',
      false,
    )
    expect(result).toEqual({ changedTables: ['notifications'] })
  })

  it('投稿が見つからない場合は何もしない', () => {
    vi.mocked(resolvePostId).mockReturnValue(undefined)

    const { db } = createMockDb()

    const result = handleUpdateNotificationStatusAction(
      db,
      'https://example.com',
      'nonexistent',
      'favourited',
      true,
    )

    expect(updateInteraction).not.toHaveBeenCalled()
    expect(result).toEqual({ changedTables: [] })
  })

  it('localAccountId が見つからない場合は何もしない', () => {
    vi.mocked(resolvePostId).mockReturnValue(100)
    vi.mocked(resolveLocalAccountId).mockReturnValue(null)

    const { db } = createMockDb()

    const result = handleUpdateNotificationStatusAction(
      db,
      'https://example.com',
      'status-123',
      'favourited',
      true,
    )

    expect(updateInteraction).not.toHaveBeenCalled()
    expect(result).toEqual({ changedTables: [] })
  })
})
