import { getSqliteDb } from 'util/db/sqlite/connection'
import { fetchStatusesByIds } from 'util/db/sqlite/queries/statusFetch'
import { MAX_QUERY_LIMIT } from 'util/db/sqlite/queries/statusSelect'
import {
  getBookmarkedStatuses,
  getStatusesByTag,
  getStatusesByTimelineType,
} from 'util/db/sqlite/stores/statusTimelineQueries'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('util/db/sqlite/connection', () => ({
  getSqliteDb: vi.fn(),
}))

vi.mock('util/db/sqlite/queries/statusFetch', () => ({
  fetchStatusesByIds: vi.fn(),
}))

function installHandle(rows: unknown[] = []) {
  const execAsync = vi.fn().mockResolvedValue(rows)
  const handle = { execAsync }
  vi.mocked(getSqliteDb).mockResolvedValue(handle as never)
  vi.mocked(fetchStatusesByIds).mockResolvedValue([
    { id: 'assembled-status' },
  ] as never)
  return { execAsync, handle }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getStatusesByTimelineType', () => {
  it('post_id と timelineTypes を取得して詳細フェッチへ引き渡す', async () => {
    const { execAsync, handle } = installHandle([
      [11, '["home","local"]'],
      [22, null],
    ])

    await expect(getStatusesByTimelineType('home')).resolves.toEqual([
      { id: 'assembled-status' },
    ])

    expect(execAsync).toHaveBeenCalledWith(
      expect.stringMatching(
        /INNER JOIN timeline_entries te.*WHERE te\.timeline_key = \?/s,
      ),
      {
        bind: ['home', MAX_QUERY_LIMIT],
        kind: 'timeline',
        returnValue: 'resultRows',
      },
    )
    expect(fetchStatusesByIds).toHaveBeenCalledWith(
      handle,
      [11, 22],
      new Map([[11, '["home","local"]']]),
    )
  })

  it('timelineType、backend URL、limit を SQL の placeholder 順で bind する', async () => {
    const { execAsync } = installHandle([])

    await getStatusesByTimelineType(
      'local',
      ['https://one.example', 'https://two.example'],
      7,
    )

    const [sql, options] = execAsync.mock.calls[0]
    expect(sql).toContain('la.backend_url IN (?,?)')
    expect(options.bind).toEqual([
      'local',
      'https://one.example',
      'https://two.example',
      7,
    ])
  })
})

describe('getStatusesByTag', () => {
  it('タグ、backend URL、limit を SQL の placeholder 順で bind する', async () => {
    const { execAsync, handle } = installHandle([[31], [32]])

    await getStatusesByTag(
      'TypeScript',
      ['https://one.example', 'https://two.example'],
      5,
    )

    const [sql, options] = execAsync.mock.calls[0]
    expect(sql).toMatch(/INNER JOIN hashtags ht.*WHERE ht\.name = LOWER\(\?\)/s)
    expect(sql).toContain('la.backend_url IN (?,?)')
    expect(options).toEqual({
      bind: ['TypeScript', 'https://one.example', 'https://two.example', 5],
      kind: 'timeline',
      returnValue: 'resultRows',
    })
    expect(fetchStatusesByIds).toHaveBeenCalledWith(handle, [31, 32])
  })

  it('空の backend URL 配列では filter を追加せず、空 ID も詳細フェッチへ渡す', async () => {
    const { execAsync, handle } = installHandle([])

    await getStatusesByTag('testing', [])

    const [sql, options] = execAsync.mock.calls[0]
    expect(sql).not.toContain('la.backend_url IN')
    expect(options.bind).toEqual(['testing', MAX_QUERY_LIMIT])
    expect(fetchStatusesByIds).toHaveBeenCalledWith(handle, [])
  })
})

describe('getBookmarkedStatuses', () => {
  it('ブックマーク条件と既定 limit で取得する', async () => {
    const { execAsync, handle } = installHandle([[41]])

    await getBookmarkedStatuses()

    expect(execAsync).toHaveBeenCalledWith(
      expect.stringMatching(
        /INNER JOIN post_interactions pi.*WHERE pi\.is_bookmarked = 1/s,
      ),
      {
        bind: [MAX_QUERY_LIMIT],
        kind: 'timeline',
        returnValue: 'resultRows',
      },
    )
    expect(fetchStatusesByIds).toHaveBeenCalledWith(handle, [41])
  })

  it('backend filter の bind を limit より前に渡す', async () => {
    const { execAsync } = installHandle([])

    await getBookmarkedStatuses(['https://social.example'], 9)

    const [sql, options] = execAsync.mock.calls[0]
    expect(sql).toContain('la.backend_url IN (?)')
    expect(options.bind).toEqual(['https://social.example', 9])
  })
})

describe('問い合わせ失敗', () => {
  it('ID 取得が失敗した場合は詳細フェッチを呼ばずエラーを返す', async () => {
    const execAsync = vi.fn().mockRejectedValue(new Error('phase 1 failed'))
    vi.mocked(getSqliteDb).mockResolvedValue({ execAsync } as never)

    await expect(getStatusesByTag('testing')).rejects.toThrow('phase 1 failed')
    expect(fetchStatusesByIds).not.toHaveBeenCalled()
  })

  it('詳細フェッチのエラーを呼び出し元へ返す', async () => {
    installHandle([[1]])
    vi.mocked(fetchStatusesByIds).mockRejectedValue(new Error('phase 2 failed'))

    await expect(getBookmarkedStatuses()).rejects.toThrow('phase 2 failed')
  })
})
