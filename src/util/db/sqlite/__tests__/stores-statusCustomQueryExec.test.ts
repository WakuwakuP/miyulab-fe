import { getSqliteDb } from 'util/db/sqlite/connection'
import { fetchStatusesByIds } from 'util/db/sqlite/queries/statusFetch'
import { MAX_QUERY_LIMIT } from 'util/db/sqlite/queries/statusSelect'
import {
  getStatusesByCustomQuery,
  validateCustomQuery,
} from 'util/db/sqlite/stores/statusCustomQueryExec'
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

describe('getStatusesByCustomQuery', () => {
  it('参照された互換テーブルだけを JOIN し backend filter とページングを bind する', async () => {
    const { execAsync, handle } = installHandle([[101], [202]])
    const query =
      "ptt.timelineType = 'home' AND pbt.tag = 'tech' AND " +
      "pme.acct = 'alice@example.com' AND prb.original_uri IS NOT NULL AND " +
      'pe.is_bookmarked = 1 LIMIT 999 OFFSET 888;'

    await expect(
      getStatusesByCustomQuery(
        query,
        ['https://one.example', 'https://two.example'],
        12,
        4,
      ),
    ).resolves.toEqual([{ id: 'assembled-status' }])

    const [sql, options] = execAsync.mock.calls[0]
    expect(sql).toContain('LEFT JOIN timeline_entries ptt')
    expect(sql).toContain('LEFT JOIN post_hashtags pht')
    expect(sql).toContain('LEFT JOIN hashtags ht')
    expect(sql).toContain('LEFT JOIN post_mentions pme')
    expect(sql).toContain('LEFT JOIN (SELECT rb_src.id AS post_id')
    expect(sql).toContain('LEFT JOIN post_interactions pe')
    expect(sql).toContain("ht.name = 'tech'")
    expect(sql).not.toContain('pbt.tag')
    expect(sql).not.toContain('LIMIT 999')
    expect(sql).not.toContain('OFFSET 888')
    expect(sql).toContain('la.backend_url IN (?,?)')
    expect(options).toEqual({
      bind: ['https://one.example', 'https://two.example', 12, 4],
      kind: 'timeline',
      returnValue: 'resultRows',
    })
    expect(fetchStatusesByIds).toHaveBeenCalledWith(handle, [101, 202])
  })

  it('空の WHERE 句には 1=1 と既定ページングを使い、不要な JOIN を追加しない', async () => {
    const { execAsync, handle } = installHandle([])

    await getStatusesByCustomQuery(' ; LIMIT 9 OFFSET 2', [])

    const [sql, options] = execAsync.mock.calls[0]
    expect(sql).toContain('WHERE (1=1)')
    expect(sql).not.toContain('LEFT JOIN timeline_entries ptt')
    expect(sql).not.toContain('la.backend_url IN')
    expect(options.bind).toEqual([MAX_QUERY_LIMIT, 0])
    expect(fetchStatusesByIds).toHaveBeenCalledWith(handle, [])
  })

  it('0 の limit と offset を有効な値として保持する', async () => {
    const { execAsync } = installHandle([])

    await getStatusesByCustomQuery("p.language = 'ja'", undefined, 0, 0)

    expect(execAsync.mock.calls[0][1].bind).toEqual([0, 0])
  })

  it('禁止 SQL とコメントを詳細取得前に拒否する', async () => {
    const { execAsync } = installHandle([])

    await expect(
      getStatusesByCustomQuery("p.language = 'ja'; DELETE FROM posts"),
    ).rejects.toThrow('forbidden SQL statements')
    await expect(
      getStatusesByCustomQuery("p.language = 'ja' -- ignore filter"),
    ).rejects.toThrow('SQL comments')
    expect(execAsync).not.toHaveBeenCalled()
    expect(fetchStatusesByIds).not.toHaveBeenCalled()
  })

  it('詳細フェッチのエラーを呼び出し元へ返す', async () => {
    installHandle([[1]])
    vi.mocked(fetchStatusesByIds).mockRejectedValue(new Error('phase 2 failed'))

    await expect(getStatusesByCustomQuery("p.language = 'ja'")).rejects.toThrow(
      'phase 2 failed',
    )
  })
})

describe('validateCustomQuery', () => {
  it.each(['', '   ', ' ; LIMIT 10 OFFSET 5 ;;'])(
    '実質的に空のクエリ %j は DB を使わず有効とする',
    async (query) => {
      await expect(validateCustomQuery(query)).resolves.toBeNull()
      expect(getSqliteDb).not.toHaveBeenCalled()
    },
  )

  it.each([
    'DROP',
    'DELETE',
    'INSERT',
    'UPDATE',
    'ALTER',
    'CREATE',
    'ATTACH',
    'DETACH',
    'PRAGMA',
    'VACUUM',
    'REINDEX',
  ])('%s を含むクエリを EXPLAIN 前に拒否する', async (keyword) => {
    const result = await validateCustomQuery(
      `p.language = 'ja' OR ${keyword} = 1`,
    )

    expect(result).toBe(
      'クエリに禁止されたSQL文が含まれています。WHERE句のみ使用可能です。',
    )
    expect(getSqliteDb).not.toHaveBeenCalled()
  })

  it('Status クエリを v2 互換 JOIN 付きで EXPLAIN する', async () => {
    const { execAsync } = installHandle([])

    await expect(
      validateCustomQuery("ptt.timelineType = 'home' LIMIT 100;"),
    ).resolves.toBeNull()

    const sql = execAsync.mock.calls[0][0]
    expect(sql).toContain('EXPLAIN')
    expect(sql).toContain('SELECT DISTINCT p.id')
    expect(sql).toContain(
      'SELECT te2.post_id, te2.timeline_key AS timelineType',
    )
    expect(sql).toContain("WHERE (ptt.timelineType = 'home')")
    expect(sql).not.toContain('LIMIT 100')
  })

  it('Notification クエリを通知専用の SELECT で EXPLAIN する', async () => {
    const { execAsync } = installHandle([])

    await expect(
      validateCustomQuery("n.notification_type = 'follow'"),
    ).resolves.toBeNull()

    const sql = execAsync.mock.calls[0][0]
    expect(sql).toContain('SELECT DISTINCT n.id')
    expect(sql).toContain("WHERE (nt.name = 'follow')")
    expect(sql).not.toContain('UNION ALL')
  })

  it('Status と Notification の混合クエリを UNION ALL で EXPLAIN する', async () => {
    const { execAsync } = installHandle([])

    await expect(
      validateCustomQuery(
        "p.language = 'ja' OR n.notification_type = 'mention'",
      ),
    ).resolves.toBeNull()

    const sql = execAsync.mock.calls[0][0]
    expect(sql).toContain('SELECT post_id FROM (')
    expect(sql).toContain('UNION ALL')
    expect(sql).toContain("p.language = 'ja' OR nt.name = 'mention'")
  })

  it('SQLite の Error を読みやすい検証メッセージに変換する', async () => {
    const execAsync = vi.fn().mockRejectedValue(new Error('no such column: x'))
    vi.mocked(getSqliteDb).mockResolvedValue({ execAsync } as never)

    await expect(validateCustomQuery('p.x = 1')).resolves.toBe(
      'クエリエラー: no such column: x',
    )
  })

  it('Error 以外の throw も文字列化して検証メッセージに変換する', async () => {
    const execAsync = vi.fn().mockRejectedValue('sqlite unavailable')
    vi.mocked(getSqliteDb).mockResolvedValue({ execAsync } as never)

    await expect(validateCustomQuery('p.id > 0')).resolves.toBe(
      'クエリエラー: sqlite unavailable',
    )
  })

  it('DB handle の取得失敗も検証エラーとして返す', async () => {
    vi.mocked(getSqliteDb).mockRejectedValue(new Error('database not ready'))

    await expect(validateCustomQuery('p.id > 0')).resolves.toBe(
      'クエリエラー: database not ready',
    )
  })
})
