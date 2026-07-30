import { getSqliteDb } from 'util/db/sqlite/connection'
import {
  getDistinctColumnValues,
  getDistinctTags,
  getDistinctTimelineTypes,
  searchColumnValuesDirect,
  searchDistinctColumnValues,
} from 'util/db/sqlite/stores/statusColumnValues'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('util/db/sqlite/connection', () => ({
  getSqliteDb: vi.fn(),
}))

function installExecResult(rows: unknown[] = []) {
  const execAsync = vi.fn().mockResolvedValue(rows)
  vi.mocked(getSqliteDb).mockResolvedValue({ execAsync } as never)
  return execAsync
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('固定候補値の取得', () => {
  it('タグ名をソート済みクエリから取り出す', async () => {
    const execAsync = installExecResult([['alpha'], ['beta']])

    await expect(getDistinctTags()).resolves.toEqual(['alpha', 'beta'])
    expect(execAsync).toHaveBeenCalledWith(
      'SELECT DISTINCT ht.name FROM post_hashtags pht INNER JOIN hashtags ht ON pht.hashtag_id = ht.id ORDER BY ht.name;',
      { returnValue: 'resultRows' },
    )
  })

  it('タイムライン種別をソート済みクエリから取り出す', async () => {
    const execAsync = installExecResult([['home'], ['local']])

    await expect(getDistinctTimelineTypes()).resolves.toEqual(['home', 'local'])
    expect(execAsync).toHaveBeenCalledWith(
      'SELECT DISTINCT te.timeline_key FROM timeline_entries te ORDER BY te.timeline_key;',
      { returnValue: 'resultRows' },
    )
  })

  it('DB の取得または実行に失敗した場合は候補なしとして扱う', async () => {
    vi.mocked(getSqliteDb).mockRejectedValueOnce(new Error('not ready'))
    await expect(getDistinctTimelineTypes()).resolves.toEqual([])

    const execAsync = vi.fn().mockRejectedValue(new Error('query failed'))
    vi.mocked(getSqliteDb).mockResolvedValue({ execAsync } as never)
    await expect(getDistinctTags()).resolves.toEqual([])
  })
})

describe('getDistinctColumnValues', () => {
  it('ホワイトリスト上のテーブル・カラムだけを bind 付きで取得する', async () => {
    const execAsync = installExecResult([['ja'], ['en']])

    await expect(
      getDistinctColumnValues('posts', 'language', 7),
    ).resolves.toEqual(['ja', 'en'])
    expect(execAsync).toHaveBeenCalledWith(
      'SELECT DISTINCT "language" FROM "posts" WHERE "language" IS NOT NULL AND "language" != \'\' ORDER BY "language" LIMIT ?;',
      { bind: [7], returnValue: 'resultRows' },
    )
  })

  it.each([
    ['unknown_table', 'language'],
    ['posts', 'content_html'],
  ])('許可されていない %s.%s は DB に問い合わせない', async (table, column) => {
    const execAsync = installExecResult([['should-not-be-used']])

    await expect(getDistinctColumnValues(table, column)).resolves.toEqual([])
    expect(getSqliteDb).not.toHaveBeenCalled()
    expect(execAsync).not.toHaveBeenCalled()
  })

  it('DB エラー時は空配列へフォールバックする', async () => {
    const execAsync = vi.fn().mockRejectedValue(new Error('query failed'))
    vi.mocked(getSqliteDb).mockResolvedValue({ execAsync } as never)

    await expect(getDistinctColumnValues('profiles', 'acct')).resolves.toEqual(
      [],
    )
  })
})

describe('searchDistinctColumnValues', () => {
  it('通常のエイリアスを実テーブル・実カラムに解決する', async () => {
    const execAsync = installExecResult([['ja-JP']])

    await expect(
      searchDistinctColumnValues('p', 'language', 'ja', 4),
    ).resolves.toEqual(['ja-JP'])
    expect(execAsync).toHaveBeenCalledWith(
      expect.stringContaining('SELECT DISTINCT "language" FROM "posts"'),
      { bind: ['ja%', 4], returnValue: 'resultRows' },
    )
  })

  it('互換カラムのオーバーライドを優先し LIKE ワイルドカードをエスケープする', async () => {
    const execAsync = installExecResult([['ja%_\\server']])

    await expect(
      searchDistinctColumnValues('p', 'origin_backend_url', 'ja%_\\', 3),
    ).resolves.toEqual(['ja%_\\server'])
    expect(execAsync).toHaveBeenCalledWith(
      expect.stringMatching(
        /SELECT DISTINCT "backend_url" FROM "local_accounts".*LIKE \? ESCAPE '\\'/,
      ),
      {
        bind: ['ja\\%\\_\\\\%', 3],
        returnValue: 'resultRows',
      },
    )
  })

  it.each([
    ['unknown', 'language'],
    ['p', 'unknown_column'],
    ['pr', 'url'],
  ])(
    '解決または許可できない %s.%s は DB に問い合わせない',
    async (alias, column) => {
      const execAsync = installExecResult([['should-not-be-used']])

      await expect(
        searchDistinctColumnValues(alias, column, ''),
      ).resolves.toEqual([])
      expect(getSqliteDb).not.toHaveBeenCalled()
      expect(execAsync).not.toHaveBeenCalled()
    },
  )

  it('DB エラー時は空配列へフォールバックする', async () => {
    const execAsync = vi.fn().mockRejectedValue(new Error('query failed'))
    vi.mocked(getSqliteDb).mockResolvedValue({ execAsync } as never)

    await expect(
      searchDistinctColumnValues('p', 'language', 'ja'),
    ).resolves.toEqual([])
  })
})

describe('searchColumnValuesDirect', () => {
  it('直接指定した許可済みカラムを安全なプレフィクスで検索する', async () => {
    const execAsync = installExecResult([['alice@example.com']])

    await expect(
      searchColumnValuesDirect('profiles', 'acct', 'ali_', 2),
    ).resolves.toEqual(['alice@example.com'])
    expect(execAsync).toHaveBeenCalledWith(
      expect.stringMatching(
        /SELECT DISTINCT "acct" FROM "profiles".*LIKE \? ESCAPE '\\'/,
      ),
      { bind: ['ali\\_%', 2], returnValue: 'resultRows' },
    )
  })

  it('許可されていない直接指定は DB に問い合わせない', async () => {
    const execAsync = installExecResult([['should-not-be-used']])

    await expect(
      searchColumnValuesDirect('profiles', 'url', ''),
    ).resolves.toEqual([])
    expect(getSqliteDb).not.toHaveBeenCalled()
    expect(execAsync).not.toHaveBeenCalled()
  })

  it('DB エラー時は空配列へフォールバックする', async () => {
    const execAsync = vi.fn().mockRejectedValue(new Error('query failed'))
    vi.mocked(getSqliteDb).mockResolvedValue({ execAsync } as never)

    await expect(
      searchColumnValuesDirect('profiles', 'acct', 'ali'),
    ).resolves.toEqual([])
  })
})
