import {
  toggleReaction,
  updateInteraction,
} from 'util/db/sqlite/helpers/interaction'
import type { DbExecCompat } from 'util/db/sqlite/helpers/types'
import {
  handleToggleReaction,
  handleUpdateStatusAction,
} from 'util/db/sqlite/worker/handlers/interactionHandlers'
import { resolvePostIdInternal } from 'util/db/sqlite/worker/handlers/statusHelpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── モジュールモック ───────────────────────────────────────────

vi.mock('util/db/sqlite/helpers/interaction', () => ({
  toggleReaction: vi.fn(),
  updateInteraction: vi.fn(),
}))

vi.mock(
  'util/db/sqlite/worker/handlers/statusHelpers',
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import('util/db/sqlite/worker/handlers/statusHelpers')
      >()
    return {
      ...original,
      resolvePostIdInternal: vi.fn(),
    }
  },
)

// ─── 型 ─────────────────────────────────────────────────────────

type ExecCall = { sql: string; opts?: Parameters<DbExecCompat['exec']>[1] }

// ─── Mock DB factory ────────────────────────────────────────────

/**
 * DbExecCompat のモックを作成する。
 * SELECT の returnValue === 'resultRows' のとき、selectResults を順番に返す。
 */
function createMockDb(selectResults: unknown[][] = []): {
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
        return result !== undefined ? result : []
      }
      return undefined
    }),
  }

  return { calls, db }
}

// ─── セットアップ ───────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ================================================================
// handleUpdateStatusAction
// ================================================================

describe('handleUpdateStatusAction', () => {
  it('favourite アクションで updateInteraction を呼び出す', () => {
    const { db } = createMockDb()
    vi.mocked(resolvePostIdInternal).mockReturnValue(100)

    const result = handleUpdateStatusAction(db, 1, '12345', 'favourited', true)

    expect(resolvePostIdInternal).toHaveBeenCalledWith(db, 1, '12345')
    expect(updateInteraction).toHaveBeenCalledWith(
      db,
      100,
      1,
      'favourite',
      true,
    )
    expect(result).toEqual({ changedTables: ['posts'] })
  })

  it('reblog アクションを処理する', () => {
    const { db } = createMockDb()
    vi.mocked(resolvePostIdInternal).mockReturnValue(200)

    const result = handleUpdateStatusAction(db, 2, '67890', 'reblogged', true)

    expect(resolvePostIdInternal).toHaveBeenCalledWith(db, 2, '67890')
    expect(updateInteraction).toHaveBeenCalledWith(db, 200, 2, 'reblog', true)
    expect(result).toEqual({ changedTables: ['posts'] })
  })

  it('bookmark アクションを処理する', () => {
    const { db } = createMockDb()
    vi.mocked(resolvePostIdInternal).mockReturnValue(300)

    const result = handleUpdateStatusAction(db, 3, 'abc', 'bookmarked', false)

    expect(resolvePostIdInternal).toHaveBeenCalledWith(db, 3, 'abc')
    expect(updateInteraction).toHaveBeenCalledWith(
      db,
      300,
      3,
      'bookmark',
      false,
    )
    expect(result).toEqual({ changedTables: ['posts'] })
  })

  it('投稿が見つからない場合は何もしない', () => {
    const { db } = createMockDb()
    vi.mocked(resolvePostIdInternal).mockReturnValue(undefined)

    const result = handleUpdateStatusAction(
      db,
      1,
      'nonexistent',
      'favourited',
      true,
    )

    expect(resolvePostIdInternal).toHaveBeenCalledWith(db, 1, 'nonexistent')
    expect(updateInteraction).not.toHaveBeenCalled()
    expect(result).toEqual({ changedTables: [] })
  })

  it('リブログ元の投稿にもインタラクションを伝播する', () => {
    // resolvePostIdInternal → post_id=100
    // SELECT reblog_of_post_id FROM posts WHERE id = 100 → 50 (元投稿)
    // SELECT id FROM posts WHERE reblog_of_post_id = 100 → [] (この投稿をリブログした他投稿なし)
    const { db } = createMockDb([
      [[50]], // reblog_of_post_id for post 100
      [], // no posts reblogging post 100
    ])
    vi.mocked(resolvePostIdInternal).mockReturnValue(100)

    handleUpdateStatusAction(db, 1, '12345', 'favourited', true)

    // 自身 + 元投稿の2回呼ばれる
    expect(updateInteraction).toHaveBeenCalledTimes(2)
    expect(updateInteraction).toHaveBeenCalledWith(
      db,
      100,
      1,
      'favourite',
      true,
    )
    expect(updateInteraction).toHaveBeenCalledWith(db, 50, 1, 'favourite', true)
  })

  it('このポストを reblog している他の投稿にも伝播する', () => {
    // resolvePostIdInternal → post_id=100
    // SELECT reblog_of_post_id FROM posts WHERE id = 100 → null (元投稿なし)
    // SELECT id FROM posts WHERE reblog_of_post_id = 100 → [200, 300]
    const { db } = createMockDb([
      [[null]], // reblog_of_post_id = null
      [[200], [300]], // posts that reblog post 100
    ])
    vi.mocked(resolvePostIdInternal).mockReturnValue(100)

    handleUpdateStatusAction(db, 1, '12345', 'reblogged', true)

    // 自身 + リブログ2件 = 3回
    expect(updateInteraction).toHaveBeenCalledTimes(3)
    expect(updateInteraction).toHaveBeenCalledWith(db, 100, 1, 'reblog', true)
    expect(updateInteraction).toHaveBeenCalledWith(db, 200, 1, 'reblog', true)
    expect(updateInteraction).toHaveBeenCalledWith(db, 300, 1, 'reblog', true)
  })
})

// ================================================================
// handleToggleReaction
// ================================================================

describe('handleToggleReaction', () => {
  it('Unicode 絵文字のリアクションを設定する', () => {
    const { db } = createMockDb()
    vi.mocked(resolvePostIdInternal).mockReturnValue(100)

    const result = handleToggleReaction(db, 1, '12345', true, '👍')

    expect(resolvePostIdInternal).toHaveBeenCalledWith(db, 1, '12345')
    expect(toggleReaction).toHaveBeenCalledWith(db, 100, 1, '👍', null)
    expect(result).toEqual({ changedTables: ['posts'] })
  })

  it('カスタム絵文字のリアクションを設定する（shortcode → url 解決）', () => {
    // SELECT id, url FROM custom_emojis WHERE server_id = ? AND shortcode = ?
    const { db } = createMockDb([
      [[42, 'https://example.com/emoji/blobcat.png']],
    ])
    vi.mocked(resolvePostIdInternal).mockReturnValue(100)

    const result = handleToggleReaction(db, 1, '12345', true, ':blobcat:')

    expect(resolvePostIdInternal).toHaveBeenCalledWith(db, 1, '12345')
    // custom_emojis を検索するSQLが発行される
    const emojiSelect = (db.exec as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === 'string' && call[0].includes('custom_emojis'),
    )
    expect(emojiSelect).toBeDefined()
    expect(emojiSelect?.[0]).toContain('SELECT')
    expect(emojiSelect?.[0]).toContain('custom_emojis')
    expect(emojiSelect?.[1]?.bind).toContain('blobcat')

    expect(toggleReaction).toHaveBeenCalledWith(
      db,
      100,
      1,
      'blobcat',
      'https://example.com/emoji/blobcat.png',
    )
    expect(result).toEqual({ changedTables: ['posts'] })
  })

  it('リアクションをクリアする（value=false）', () => {
    const { db } = createMockDb()
    vi.mocked(resolvePostIdInternal).mockReturnValue(100)

    const result = handleToggleReaction(db, 1, '12345', false, '👍')

    expect(resolvePostIdInternal).toHaveBeenCalledWith(db, 1, '12345')
    expect(toggleReaction).toHaveBeenCalledWith(db, 100, 1, null, null)
    expect(result).toEqual({ changedTables: ['posts'] })
  })

  it('投稿が見つからない場合は何もしない', () => {
    const { db } = createMockDb()
    vi.mocked(resolvePostIdInternal).mockReturnValue(undefined)

    const result = handleToggleReaction(db, 1, 'nonexistent', true, '👍')

    expect(resolvePostIdInternal).toHaveBeenCalledWith(db, 1, 'nonexistent')
    expect(toggleReaction).not.toHaveBeenCalled()
    expect(result).toEqual({ changedTables: [] })
  })
})
