import { describe, expect, it, vi } from 'vitest'
import { executeFlatFetch } from '../executor/flatFetchExecutor'
import type { FlatFetchRequest } from '../executor/flatFetchTypes'

type SqlValue = string | number | null

// ================================================================
// ヘルパー
// ================================================================

/**
 * POST_FLAT_SELECT の30カラム行モック
 */
function makePostRow(
  postId: number,
  overrides: Partial<{ reblogOfPostId: number | null }> = {},
): SqlValue[] {
  const row: SqlValue[] = new Array(30).fill(null)
  row[0] = postId
  row[1] = `https://example.com/objects/${postId}`
  row[3] = '<p>test</p>'
  row[4] = 1700000000000 + postId
  row[7] = 0
  row[8] = ''
  row[10] = overrides.reblogOfPostId ?? null
  row[11] = overrides.reblogOfPostId == null ? 0 : 1
  row[13] = 'public'
  row[14] = 100 + postId
  row[15] = `user${postId}@example.com`
  row[16] = `user${postId}`
  row[17] = `User ${postId}`
  row[18] = ''
  row[19] = ''
  row[20] = 0
  row[21] = 0
  row[22] = ''
  row[23] = 0
  row[24] = 0
  row[25] = 0
  row[27] = 'https://example.com'
  row[28] = `local_${postId}`
  row[29] = ''
  return row
}

/**
 * NOTIFICATION_FLAT_SELECT の19カラム行モック
 */
function makeNotifRow(
  id: number,
  overrides: Partial<{
    actorProfileId: number | null
    relatedPostId: number | null
  }> = {},
): SqlValue[] {
  const row: SqlValue[] = new Array(19).fill(null)
  row[0] = id
  row[1] = 1
  row[2] = `notif_${id}`
  row[3] = 1700000000000 + id
  row[4] = 0
  row[5] = overrides.relatedPostId ?? null
  row[8] = overrides.actorProfileId ?? 200 + id
  row[9] = 'favourite'
  row[10] = 'https://example.com'
  row[11] = `actor${id}@example.com`
  row[12] = `actor${id}`
  row[13] = `Actor ${id}`
  row[14] = ''
  row[15] = ''
  row[16] = 0
  row[17] = 0
  row[18] = ''
  return row
}

/**
 * db.exec モック — 呼び出し順にレスポンスを返す
 */
function mockDb(responses: Record<number, SqlValue[][]> = {}) {
  const calls: { bind: unknown[]; sql: string }[] = []
  let callIndex = 0
  return {
    calls,
    exec: vi.fn(
      (sql: string, opts: { bind?: unknown[]; returnValue?: string }) => {
        const idx = callIndex++
        calls.push({ bind: opts.bind ?? [], sql })
        return responses[idx] ?? []
      },
    ),
  }
}

function makeRequest(
  overrides: Partial<FlatFetchRequest> = {},
): FlatFetchRequest {
  return {
    backendUrls: ['https://example.com'],
    displayOrder: [],
    notificationIds: [],
    postIds: [],
    ...overrides,
  }
}

// ================================================================
// テスト
// ================================================================

describe('executeFlatFetch', () => {
  it('複数通知のアクター絵文字をプロフィールIDで一括取得し、対応する通知に割り当てる', () => {
    const emoji = {
      shortcode: 'wave',
      static_url: 'https://example.com/wave.png',
      url: 'https://example.com/wave.png',
    }
    const db = mockDb({
      0: [
        makeNotifRow(1, { actorProfileId: 20 }),
        makeNotifRow(2, { actorProfileId: 30 }),
        makeNotifRow(3, { actorProfileId: 20 }),
      ],
      1: [[20, JSON.stringify([emoji])]],
    })
    const result = executeFlatFetch(
      db,
      makeRequest({ notificationIds: [1, 2, 3] }),
    )
    expect(db.calls[1].bind).toEqual([20, 30])
    expect(db.calls[1].sql).toMatch(/IN\s*\(\?,\s*\?\)/i)
    for (const id of [1, 3]) {
      expect(result.notifications.get(id)?.account.emojis).toMatchObject([
        emoji,
      ])
    }
    expect(result.notifications.get(2)?.account.emojis).toEqual([])
  })

  it('共有されたブースト元と通知の関連投稿を一度ずつ取得し、バッチ対象にも含める', () => {
    const db = mockDb({
      0: [
        makePostRow(1, { reblogOfPostId: 10 }),
        makePostRow(2, { reblogOfPostId: 10 }),
      ],
      1: [makePostRow(10)],
      2: [
        makeNotifRow(3, { relatedPostId: 10 }),
        makeNotifRow(4, { relatedPostId: 20 }),
        makeNotifRow(5, { relatedPostId: 20 }),
      ],
      3: [makePostRow(20)],
    })
    const result = executeFlatFetch(
      db,
      makeRequest({ notificationIds: [3, 4, 5], postIds: [1, 2] }),
    )
    expect(db.calls[1].bind).toEqual([10])
    expect(db.calls[3].bind).toEqual([20])
    const media = db.calls.find(({ sql }) => sql.includes('FROM post_media'))
    expect(media?.bind).toEqual([1, 2, 10, 20])
    expect(media?.sql).toMatch(/IN\s*\(\?,\?,\?,\?\)/i)
    expect(result.posts.get(2)?.reblog?.id).toBe('local_10')
    expect(result.notifications.get(5)?.status?.id).toBe('local_20')
  })

  // --- 空入力 ---
  describe('空入力', () => {
    it('全 ID が空の場合、空の結果を返す', () => {
      const db = mockDb()
      const result = executeFlatFetch(db, makeRequest())

      expect(result.posts.size).toBe(0)
      expect(result.notifications.size).toBe(0)
      expect(result.displayOrder).toEqual([])
      expect(result.meta.sourceType).toBe('post')
      expect(db.exec).not.toHaveBeenCalled()
    })
  })

  // --- posts のみ ---
  describe('posts のみ', () => {
    it('sourceType が "post" になる', () => {
      const db = mockDb({ 0: [makePostRow(1), makePostRow(2)] })
      const result = executeFlatFetch(
        db,
        makeRequest({
          displayOrder: [
            { id: 1, table: 'posts' },
            { id: 2, table: 'posts' },
          ],
          postIds: [1, 2],
        }),
      )

      expect(result.meta.sourceType).toBe('post')
    })

    it('コアクエリとバッチクエリが実行される', () => {
      const db = mockDb({ 0: [makePostRow(1)] })
      executeFlatFetch(db, makeRequest({ postIds: [1] }))

      // 1 core query + 8 batch queries = 9 calls
      expect(db.exec).toHaveBeenCalledTimes(9)
      expect(db.calls[0].sql).toContain('posts p')
    })

    it('結果の postMap にデータが含まれる', () => {
      const db = mockDb({ 0: [makePostRow(1)] })
      const result = executeFlatFetch(db, makeRequest({ postIds: [1] }))

      expect(result.posts.size).toBe(1)
      expect(result.posts.has(1)).toBe(true)
      const status = result.posts.get(1)
      expect(status?.post_id).toBe(1)
      expect(status?.backendUrl).toBe('https://example.com')
    })

    it('notification は空', () => {
      const db = mockDb({ 0: [makePostRow(1)] })
      const result = executeFlatFetch(db, makeRequest({ postIds: [1] }))

      expect(result.notifications.size).toBe(0)
    })
  })

  // --- notifications のみ ---
  describe('notifications のみ', () => {
    it('sourceType が "notification" になる', () => {
      const db = mockDb({ 0: [makeNotifRow(10)] })
      const result = executeFlatFetch(
        db,
        makeRequest({ notificationIds: [10] }),
      )

      expect(result.meta.sourceType).toBe('notification')
    })

    it('通知コアクエリとアクター絵文字バッチが実行される', () => {
      const db = mockDb({
        0: [makeNotifRow(10, { actorProfileId: 200 })],
      })
      executeFlatFetch(db, makeRequest({ notificationIds: [10] }))

      expect(db.calls[0].sql).toContain('notifications n')
      expect(
        db.calls.some((c) => c.sql.includes('profile_custom_emojis')),
      ).toBe(true)
    })

    it('posts は空', () => {
      const db = mockDb({ 0: [makeNotifRow(10)] })
      const result = executeFlatFetch(
        db,
        makeRequest({ notificationIds: [10] }),
      )

      expect(result.posts.size).toBe(0)
    })
  })

  // --- mixed ---
  describe('mixed mode', () => {
    it('sourceType が "mixed" になる', () => {
      const db = mockDb({
        0: [makePostRow(1)],
        1: [makeNotifRow(10)],
      })
      const result = executeFlatFetch(
        db,
        makeRequest({ notificationIds: [10], postIds: [1] }),
      )

      expect(result.meta.sourceType).toBe('mixed')
    })
  })

  // --- リブログ展開 ---
  describe('リブログ展開', () => {
    it('reblog_of_post_id がある場合、親投稿の追加クエリが実行される', () => {
      const db = mockDb({
        0: [makePostRow(1, { reblogOfPostId: 99 })],
        1: [makePostRow(99)],
      })
      const result = executeFlatFetch(db, makeRequest({ postIds: [1] }))

      // 2 core queries + 8 batch queries = 10
      expect(db.exec).toHaveBeenCalledTimes(10)
      expect(result.posts.has(99)).toBe(true)
      const reblogStatus = result.posts.get(1)
      expect(reblogStatus?.reblog).not.toBeNull()
      expect(Reflect.get(reblogStatus?.reblog ?? {}, 'post_id')).toBe(99)
    })

    it('reblog_of_post_id が入力 postIds に含まれる場合、追加クエリは不要', () => {
      const db = mockDb({
        0: [makePostRow(1, { reblogOfPostId: 2 }), makePostRow(2)],
      })
      executeFlatFetch(db, makeRequest({ postIds: [1, 2] }))

      // 1 core query + 8 batch queries = 9 (追加クエリなし)
      expect(db.exec).toHaveBeenCalledTimes(9)
    })
  })

  // --- 通知の related post 展開 ---
  describe('通知の related post 展開', () => {
    it('related_post_id がある場合、投稿の追加クエリが実行される', () => {
      const db = mockDb({
        0: [makeNotifRow(10, { relatedPostId: 50 })],
        1: [makePostRow(50)],
      })
      const result = executeFlatFetch(
        db,
        makeRequest({ notificationIds: [10] }),
      )

      const notif = result.notifications.get(10)
      expect(notif?.status).toBeDefined()
      expect(Reflect.get(notif?.status ?? {}, 'post_id')).toBe(50)
    })
  })

  // --- displayOrder パススルー ---
  describe('displayOrder', () => {
    it('リクエストの displayOrder がそのまま返される', () => {
      const db = mockDb()
      const displayOrder = [
        { id: 1, table: 'posts' as const },
        { id: 10, table: 'notifications' as const },
      ]
      const result = executeFlatFetch(db, makeRequest({ displayOrder }))

      expect(result.displayOrder).toEqual(displayOrder)
    })
  })

  // --- メタ情報 ---
  describe('メタ情報', () => {
    it('totalDurationMs はフェッチの経過時間を返す', () => {
      using clock = vi
        .spyOn(performance, 'now')
        .mockReturnValueOnce(40)
        .mockReturnValueOnce(47)
      const db = mockDb()
      const result = executeFlatFetch(db, makeRequest())

      expect(clock).toHaveBeenCalledTimes(2)
      expect(result.meta.totalDurationMs).toBe(7)
    })
  })
})
