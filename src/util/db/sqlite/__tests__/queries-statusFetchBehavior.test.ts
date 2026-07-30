import type { SqliteHandle } from 'util/db/sqlite/queries/statusBatch'
import { fetchStatusesByIds } from 'util/db/sqlite/queries/statusFetch'
import { describe, expect, it, vi } from 'vitest'

type SqlValue = string | number | null

function makeBaseRow(postId: number, localId: string): SqlValue[] {
  const row: SqlValue[] = new Array(52).fill(null)
  Object.assign(row, {
    0: postId,
    1: 'https://example.com',
    2: localId,
    3: 1_700_000_000_000 + postId,
    4: `https://example.com/objects/${postId}`,
    5: `<p>Status ${postId}</p>`,
    6: '',
    7: `https://example.com/@alice/${postId}`,
    8: 'ja',
    9: 'public',
    10: 0,
    11: 0,
    14: 'alice@example.com',
    15: 'alice',
    16: 'Alice',
    17: 'https://example.com/avatar.png',
    18: 'https://example.com/header.png',
    19: 0,
    20: 0,
    21: 'https://example.com/@alice',
    22: 0,
    23: 0,
    24: 0,
  })
  return row
}

describe('fetchStatusesByIds behavior', () => {
  it('本体行が空なら子テーブルクエリを実行せず空配列を返す', async () => {
    const execAsync = vi.fn(async () => [])
    const handle = { execAsync } as unknown as SqliteHandle

    await expect(fetchStatusesByIds(handle, [42])).resolves.toEqual([])
    expect(execAsync).toHaveBeenCalledOnce()
  })

  it('リブログと timeline 上書きがない通常投稿も取得する', async () => {
    const row = makeBaseRow(42, 'status-42')
    let callIndex = 0
    const execAsync = vi.fn(
      async (_sql: string, _options?: Record<string, unknown>) => {
        callIndex += 1
        return callIndex === 1 ? [row] : []
      },
    )
    const handle = { execAsync } as unknown as SqliteHandle

    const statuses = await fetchStatusesByIds(handle, [42])

    expect(statuses).toHaveLength(1)
    expect(statuses[0]).toMatchObject({
      id: 'status-42',
      reblog: null,
      timelineTypes: [],
    })
    const interactionsCall = execAsync.mock.calls
      .slice(1)
      .find(([sql]) => sql.includes('FROM post_interactions'))
    expect(interactionsCall?.[1]).toMatchObject({ bind: [42] })
  })

  it('通常行を組み立て、リブログ ID を重複なくバッチ取得し、timeline map を上書きする', async () => {
    const first = makeBaseRow(42, 'status-42')
    first[11] = 1
    first[25] = 77
    first[26] = '<p>Reblogged status</p>'
    // [27] は rb_spoiler_text。リブログ ID と取り違えないことも検証する。
    first[27] = 'reblog spoiler'
    first[34] = 1_699_999_000_000
    first[35] = 'https://remote.example/objects/77'
    first[36] = 'bob@remote.example'
    first[37] = 'bob'
    first[38] = 'Bob'
    first[47] = 'remote-77'

    const second = makeBaseRow(100, 'status-100')
    second[11] = 1
    second[25] = 77
    second[26] = '<p>Same reblogged status</p>'
    second[27] = ''
    second[34] = 1_699_999_000_000
    second[35] = 'https://remote.example/objects/77'
    second[36] = 'bob@remote.example'
    second[37] = 'bob'
    second[38] = 'Bob'
    second[47] = 'remote-77'

    let callIndex = 0
    const execAsync = vi.fn(
      async (sql: string, _options?: Record<string, unknown>) => {
        callIndex += 1
        if (callIndex === 1) return [first, second]
        if (sql.includes('FROM timeline_entries')) {
          return [
            [42, '["public"]'],
            [100, '["local"]'],
          ]
        }
        return []
      },
    )
    const handle = { execAsync } as unknown as SqliteHandle
    const timelineTypes = new Map([
      [42, '["home","tag"]'],
      [100, '["home"]'],
    ])

    const statuses = await fetchStatusesByIds(handle, [42, 100], timelineTypes)

    expect(statuses.map((status) => status.id)).toEqual([
      'status-42',
      'status-100',
    ])
    expect(statuses.map((status) => status.timelineTypes)).toEqual([
      ['home', 'tag'],
      ['home'],
    ])
    expect(statuses.map((status) => status.reblog?.id)).toEqual([
      'remote-77',
      'remote-77',
    ])

    expect(execAsync).toHaveBeenCalledTimes(9)
    const calls = execAsync.mock.calls.slice(1)
    const interactionsCall = calls.find(([sql]) =>
      sql.includes('FROM post_interactions'),
    )
    const pollsCall = calls.find(([sql]) => sql.includes('FROM polls p'))
    expect(interactionsCall?.[1]).toMatchObject({ bind: [42, 100, 77] })
    expect(pollsCall?.[1]).toMatchObject({ bind: [null, 42, 100, 77] })
  })
})
