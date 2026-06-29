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
type SelectRows = unknown[][]
type SelectResultProvider = (args: {
  opts?: Parameters<DbExecCompat['exec']>[1]
  selectIndex: number
  sql: string
}) => SelectRows | undefined

type MockPost = {
  canonicalUrl?: string | null
  id: number
  objectUri?: string
  reblogOfPostId?: number | null
}

// ─── Mock DB factory ────────────────────────────────────────────

/**
 * DbExecCompat のモックを作成する。
 * SELECT の returnValue === 'resultRows' のとき、selectResults を順番に返す。
 * 関数を渡すと SQL/bind に応じた SELECT 結果を返せる。
 */
function createMockDb(
  selectResults: SelectRows[] | SelectResultProvider = [],
): {
  db: DbExecCompat
  calls: ExecCall[]
} {
  const calls: ExecCall[] = []
  let selectIndex = 0

  const db: DbExecCompat = {
    exec: vi.fn((sql: string, opts?: Parameters<DbExecCompat['exec']>[1]) => {
      calls.push({ opts, sql })
      if (opts?.returnValue === 'resultRows') {
        const result =
          typeof selectResults === 'function'
            ? selectResults({ opts, selectIndex, sql })
            : selectResults[selectIndex]
        selectIndex++
        return result !== undefined ? result : []
      }
      return undefined
    }),
  }

  return { calls, db }
}

function createInteractionSelectProvider(
  posts: MockPost[],
  fallback?: SelectResultProvider,
): SelectResultProvider {
  return (args) => {
    const { opts, sql } = args
    const bind = opts?.bind ?? []

    if (
      sql.includes(
        'SELECT object_uri, canonical_url, reblog_of_post_id FROM posts WHERE id = ?',
      )
    ) {
      const post = posts.find(({ id }) => id === bind[0])
      return post
        ? [
            [
              post.objectUri ?? '',
              post.canonicalUrl ?? null,
              post.reblogOfPostId ?? null,
            ],
          ]
        : []
    }

    if (sql.includes('WHERE id != ?') && sql.includes('canonical_url = ?')) {
      const [postId, objectUri, canonicalUrl] = bind
      return posts
        .filter((post) => post.id !== postId)
        .filter((post) => {
          const sameObjectUri = objectUri !== '' && post.objectUri === objectUri
          const sameCanonicalUrl =
            canonicalUrl !== null &&
            canonicalUrl !== '' &&
            post.canonicalUrl === canonicalUrl
          return sameObjectUri || sameCanonicalUrl
        })
        .map((post) => [post.id])
    }

    if (sql.includes('SELECT id FROM posts WHERE reblog_of_post_id = ?')) {
      return posts
        .filter((post) => post.reblogOfPostId === bind[0])
        .map((post) => [post.id])
    }

    return fallback?.(args)
  }
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
      undefined,
      { recordLocalAction: true },
    )
    expect(result).toEqual({ changedTables: ['posts', 'post_interactions'] })
  })

  it('reblog アクションを処理する', () => {
    const { db } = createMockDb()
    vi.mocked(resolvePostIdInternal).mockReturnValue(200)

    const result = handleUpdateStatusAction(db, 2, '67890', 'reblogged', true)

    expect(resolvePostIdInternal).toHaveBeenCalledWith(db, 2, '67890')
    expect(updateInteraction).toHaveBeenCalledWith(
      db,
      200,
      2,
      'reblog',
      true,
      undefined,
      { recordLocalAction: true },
    )
    expect(result).toEqual({ changedTables: ['posts', 'post_interactions'] })
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
      undefined,
      { recordLocalAction: true },
    )
    expect(result).toEqual({ changedTables: ['posts', 'post_interactions'] })
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
    const { db } = createMockDb(
      createInteractionSelectProvider([
        { id: 50, objectUri: 'https://example.com/objects/50' },
        {
          id: 100,
          objectUri: 'https://example.com/objects/100',
          reblogOfPostId: 50,
        },
      ]),
    )
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
      undefined,
      { recordLocalAction: true },
    )
    expect(updateInteraction).toHaveBeenCalledWith(
      db,
      50,
      1,
      'favourite',
      true,
      undefined,
      { recordLocalAction: true },
    )
  })

  it('このポストを reblog している他の投稿にも伝播する', () => {
    const { db } = createMockDb(
      createInteractionSelectProvider([
        { id: 100, objectUri: 'https://example.com/objects/100' },
        {
          id: 200,
          objectUri: 'https://example.com/objects/200',
          reblogOfPostId: 100,
        },
        {
          id: 300,
          objectUri: 'https://example.com/objects/300',
          reblogOfPostId: 100,
        },
      ]),
    )
    vi.mocked(resolvePostIdInternal).mockReturnValue(100)

    handleUpdateStatusAction(db, 1, '12345', 'reblogged', true)

    // 自身 + リブログ2件 = 3回
    expect(updateInteraction).toHaveBeenCalledTimes(3)
    expect(updateInteraction).toHaveBeenCalledWith(
      db,
      100,
      1,
      'reblog',
      true,
      undefined,
      { recordLocalAction: true },
    )
    expect(updateInteraction).toHaveBeenCalledWith(
      db,
      200,
      1,
      'reblog',
      true,
      undefined,
      { recordLocalAction: true },
    )
    expect(updateInteraction).toHaveBeenCalledWith(
      db,
      300,
      1,
      'reblog',
      true,
      undefined,
      { recordLocalAction: true },
    )
  })

  it('同一 canonical_url の別投稿にも favourite を伝播する', () => {
    const canonicalUrl = 'https://example.com/@alice/posts/1'
    const { db } = createMockDb(
      createInteractionSelectProvider([
        {
          canonicalUrl,
          id: 100,
          objectUri: 'https://example.com/objects/source',
        },
        {
          canonicalUrl,
          id: 150,
          objectUri: 'https://mirror.example/objects/equivalent',
        },
      ]),
    )
    vi.mocked(resolvePostIdInternal).mockReturnValue(100)

    handleUpdateStatusAction(db, 1, '12345', 'favourited', true)

    expect(updateInteraction).toHaveBeenCalledTimes(2)
    expect(updateInteraction).toHaveBeenCalledWith(
      db,
      100,
      1,
      'favourite',
      true,
      undefined,
      { recordLocalAction: true },
    )
    expect(updateInteraction).toHaveBeenCalledWith(
      db,
      150,
      1,
      'favourite',
      true,
      undefined,
      { recordLocalAction: true },
    )
  })

  it('同一 canonical_url の元投稿とそれぞれの reblog にも favourite を伝播する', () => {
    const canonicalUrl = 'https://example.com/@alice/posts/1'
    const { db } = createMockDb(
      createInteractionSelectProvider([
        {
          canonicalUrl,
          id: 100,
          objectUri: 'https://example.com/objects/source',
        },
        {
          canonicalUrl,
          id: 150,
          objectUri: 'https://mirror.example/objects/equivalent',
        },
        {
          id: 200,
          objectUri: 'https://example.com/objects/reblog-source',
          reblogOfPostId: 100,
        },
        {
          id: 250,
          objectUri: 'https://mirror.example/objects/reblog-equivalent',
          reblogOfPostId: 150,
        },
      ]),
    )
    vi.mocked(resolvePostIdInternal).mockReturnValue(200)

    handleUpdateStatusAction(db, 1, '12345', 'favourited', true)

    expect(updateInteraction).toHaveBeenCalledTimes(4)
    for (const postId of [200, 100, 150, 250]) {
      expect(updateInteraction).toHaveBeenCalledWith(
        db,
        postId,
        1,
        'favourite',
        true,
        undefined,
        { recordLocalAction: true },
      )
    }
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
    expect(result).toEqual({ changedTables: ['posts', 'post_interactions'] })
  })

  it('カスタム絵文字のリアクションを設定する（shortcode → url 解決）', () => {
    // SELECT id, url FROM custom_emojis WHERE server_id = ? AND shortcode = ?
    const { db } = createMockDb(({ sql }) =>
      sql.includes('custom_emojis')
        ? [[42, 'https://example.com/emoji/blobcat.png']]
        : [],
    )
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
    expect(result).toEqual({ changedTables: ['posts', 'post_interactions'] })
  })

  it('リアクションをクリアする（value=false）', () => {
    const { db } = createMockDb()
    vi.mocked(resolvePostIdInternal).mockReturnValue(100)

    const result = handleToggleReaction(db, 1, '12345', false, '👍')

    expect(resolvePostIdInternal).toHaveBeenCalledWith(db, 1, '12345')
    expect(toggleReaction).toHaveBeenCalledWith(db, 100, 1, null, null)
    expect(result).toEqual({ changedTables: ['posts', 'post_interactions'] })
  })

  it('reblog からのリアクションを元投稿と同じ元投稿の reblog に伝播する', () => {
    const { db } = createMockDb(
      createInteractionSelectProvider([
        { id: 50, objectUri: 'https://example.com/objects/50' },
        {
          id: 100,
          objectUri: 'https://example.com/objects/100',
          reblogOfPostId: 50,
        },
        {
          id: 200,
          objectUri: 'https://example.com/objects/200',
          reblogOfPostId: 50,
        },
      ]),
    )
    vi.mocked(resolvePostIdInternal).mockReturnValue(100)

    handleToggleReaction(db, 1, '12345', true, '👍')

    expect(toggleReaction).toHaveBeenCalledTimes(3)
    expect(toggleReaction).toHaveBeenCalledWith(db, 100, 1, '👍', null)
    expect(toggleReaction).toHaveBeenCalledWith(db, 50, 1, '👍', null)
    expect(toggleReaction).toHaveBeenCalledWith(db, 200, 1, '👍', null)
  })

  it('元投稿からのリアクションを reblog 投稿にも伝播する', () => {
    const { db } = createMockDb(
      createInteractionSelectProvider([
        { id: 100, objectUri: 'https://example.com/objects/100' },
        {
          id: 200,
          objectUri: 'https://example.com/objects/200',
          reblogOfPostId: 100,
        },
        {
          id: 300,
          objectUri: 'https://example.com/objects/300',
          reblogOfPostId: 100,
        },
      ]),
    )
    vi.mocked(resolvePostIdInternal).mockReturnValue(100)

    handleToggleReaction(db, 1, '12345', true, '👍')

    expect(toggleReaction).toHaveBeenCalledTimes(3)
    expect(toggleReaction).toHaveBeenCalledWith(db, 100, 1, '👍', null)
    expect(toggleReaction).toHaveBeenCalledWith(db, 200, 1, '👍', null)
    expect(toggleReaction).toHaveBeenCalledWith(db, 300, 1, '👍', null)
  })

  it('同一 canonical_url の別投稿にもリアクションを伝播する', () => {
    const canonicalUrl = 'https://example.com/@alice/posts/1'
    const { db } = createMockDb(
      createInteractionSelectProvider([
        {
          canonicalUrl,
          id: 100,
          objectUri: 'https://example.com/objects/source',
        },
        {
          canonicalUrl,
          id: 150,
          objectUri: 'https://mirror.example/objects/equivalent',
        },
      ]),
    )
    vi.mocked(resolvePostIdInternal).mockReturnValue(100)

    handleToggleReaction(db, 1, '12345', true, '👍')

    expect(toggleReaction).toHaveBeenCalledTimes(2)
    expect(toggleReaction).toHaveBeenCalledWith(db, 100, 1, '👍', null)
    expect(toggleReaction).toHaveBeenCalledWith(db, 150, 1, '👍', null)
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
