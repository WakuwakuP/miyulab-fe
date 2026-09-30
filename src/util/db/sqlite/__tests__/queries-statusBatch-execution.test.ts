import {
  BATCH_POLLS_SQL,
  batchBindForIds,
  buildBatchMapsFromResults,
  executeBatchQueries,
  replacePlaceholders,
  type SqliteHandle,
} from 'util/db/sqlite/queries/statusBatch'
import { buildScopedPollsSql } from 'util/db/sqlite/queries/statusSelect'
import { describe, expect, it, vi } from 'vitest'

function createHandle(execAsync: ReturnType<typeof vi.fn>): SqliteHandle {
  return { execAsync } as unknown as SqliteHandle
}

describe('replacePlaceholders', () => {
  it('投稿数と同数のプレースホルダに置換する', () => {
    expect(replacePlaceholders('WHERE id IN (__PH__)', 3)).toBe(
      'WHERE id IN (?,?,?)',
    )
  })

  it('空入力用には空のプレースホルダ列を生成する', () => {
    expect(replacePlaceholders('WHERE id IN (__PH__)', 0)).toBe(
      'WHERE id IN ()',
    )
  })
})

describe('buildBatchMapsFromResults', () => {
  it('各バッチ結果を post_id キーの Map に変換する', () => {
    const maps = buildBatchMapsFromResults({
      belongingTags: [[5, '["testing"]']],
      customEmojis: [[6, '[{"shortcode":"party"}]']],
      interactions: [[1, '{"is_favourited":1}']],
      media: [[2, '[{"id":"media-1"}]']],
      mentions: [[3, '[{"acct":"alice@example.com"}]']],
      polls: [[8, '{"id":"poll-1"}']],
      profileEmojis: [[7, '[{"shortcode":"wave"}]']],
      timelineTypes: [[4, '["home","local"]']],
    })

    expect(maps.interactionsMap).toEqual(new Map([[1, '{"is_favourited":1}']]))
    expect(maps.mediaMap).toEqual(new Map([[2, '[{"id":"media-1"}]']]))
    expect(maps.mentionsMap).toEqual(
      new Map([[3, '[{"acct":"alice@example.com"}]']]),
    )
    expect(maps.timelineTypesMap).toEqual(new Map([[4, '["home","local"]']]))
    expect(maps.belongingTagsMap).toEqual(new Map([[5, '["testing"]']]))
    expect(maps.customEmojisMap).toEqual(
      new Map([[6, '[{"shortcode":"party"}]']]),
    )
    expect(maps.profileEmojisMap).toEqual(
      new Map([[7, '[{"shortcode":"wave"}]']]),
    )
    expect(maps.pollsMap).toEqual(new Map([[8, '{"id":"poll-1"}']]))
    expect(maps.emojiReactionsMap).toEqual(new Map())
  })

  it('同じ post_id が複数回現れた場合は最後の値を採用する', () => {
    const maps = buildBatchMapsFromResults({
      belongingTags: [],
      customEmojis: [],
      interactions: [
        [1, 'old'],
        [1, 'new'],
      ],
      media: [],
      mentions: [],
      polls: [],
      profileEmojis: [],
      timelineTypes: [],
    })

    expect(maps.interactionsMap).toEqual(new Map([[1, 'new']]))
  })
})

describe('batchBindForIds', () => {
  it('プレースホルダ数が ID 数と一致すれば ID のみを返す', () => {
    expect(
      batchBindForIds('SELECT * FROM t WHERE post_id IN (?,?)', [1, 2]),
    ).toEqual([1, 2])
  })

  it('従来 polls テンプレートは先頭に local_account_id を 1 つ補う', () => {
    const sql = BATCH_POLLS_SQL.replace('__PH__', '?,?,?')
    expect(batchBindForIds(sql, [1, 2, 3], 9)).toEqual([9, 1, 2, 3])
  })

  it('スコープ済み polls テンプレートは先頭プレースホルダなしで ID のみ返す', () => {
    const sql = buildScopedPollsSql(['https://a.test']).replace('{IDS}', '?,?')
    expect(batchBindForIds(sql, [1, 2])).toEqual([1, 2])
  })

  it('backendUrl 内の ? やクォートはプレースホルダとして数えない', () => {
    const sql = buildScopedPollsSql(["https://a.test/x?y='z"]).replace(
      '{IDS}',
      '?',
    )
    expect(batchBindForIds(sql, [5])).toEqual([5])
  })

  it('SQL 文字列リテラル内の ? はプレースホルダとして数えない', () => {
    const sql = "SELECT 'a?b' AS literal WHERE post_id IN (?)"
    expect(batchBindForIds(sql, [7])).toEqual([7])
  })

  it('想定外の余分なプレースホルダは実行前に throw する', () => {
    const sql = 'SELECT * FROM t WHERE a = ? AND b = ? AND post_id IN (?)'
    expect(() => batchBindForIds(sql, [1])).toThrow(
      /unexpected placeholder count/,
    )
  })

  it('pv.local_account_id 以外の余分なプレースホルダ 1 つでも throw する', () => {
    const sql = 'SELECT * FROM t WHERE other_id = ? AND post_id IN (?,?)'
    expect(() => batchBindForIds(sql, [1, 2])).toThrow(
      /unexpected placeholder count/,
    )
  })
})

describe('executeBatchQueries', () => {
  it('post_id が空なら DB に問い合わせず空の Map 群を返す', async () => {
    const execAsync = vi.fn()

    const maps = await executeBatchQueries(createHandle(execAsync), [])

    expect(execAsync).not.toHaveBeenCalled()
    for (const map of Object.values(maps)) {
      expect(map).toEqual(new Map())
    }
  })

  it('8種類のバッチを実行し、bind と結果を正しく組み立てる', async () => {
    const execAsync = vi
      .fn()
      .mockResolvedValueOnce([[1, 'interaction']])
      .mockResolvedValueOnce([[2, 'media']])
      .mockResolvedValueOnce([[3, 'mention']])
      .mockResolvedValueOnce([[4, 'timeline']])
      .mockResolvedValueOnce([[5, 'tag']])
      .mockResolvedValueOnce([[6, 'emoji']])
      .mockResolvedValueOnce([[7, 'profile-emoji']])
      .mockResolvedValueOnce([[8, 'poll']])
    const handle = createHandle(execAsync)

    const maps = await executeBatchQueries(handle, [10, 20], {
      interactionsSql:
        'SELECT post_id, value FROM custom_interactions WHERE post_id IN (__PH__)',
      localAccountId: 99,
    })

    expect(execAsync).toHaveBeenCalledTimes(8)
    expect(execAsync.mock.calls[0]).toEqual([
      'SELECT post_id, value FROM custom_interactions WHERE post_id IN (?,?)',
      {
        bind: [10, 20],
        kind: 'timeline',
        returnValue: 'resultRows',
      },
    ])
    for (const call of execAsync.mock.calls.slice(1, 7)) {
      expect(call[0]).toContain('IN (?,?)')
      expect(call[1]).toEqual({
        bind: [10, 20],
        kind: 'timeline',
        returnValue: 'resultRows',
      })
      expect(call[1]).not.toHaveProperty('sessionTag')
    }
    expect(execAsync.mock.calls[7][1]).toEqual({
      bind: [99, 10, 20],
      kind: 'timeline',
      returnValue: 'resultRows',
    })
    expect(maps).toEqual({
      belongingTagsMap: new Map([[5, 'tag']]),
      customEmojisMap: new Map([[6, 'emoji']]),
      emojiReactionsMap: new Map(),
      interactionsMap: new Map([[1, 'interaction']]),
      mediaMap: new Map([[2, 'media']]),
      mentionsMap: new Map([[3, 'mention']]),
      pollsMap: new Map([[8, 'poll']]),
      profileEmojisMap: new Map([[7, 'profile-emoji']]),
      timelineTypesMap: new Map([[4, 'timeline']]),
    })
  })

  it('localAccountId 未指定時は poll の先頭 bind に null を渡す', async () => {
    const execAsync = vi.fn().mockResolvedValue([])

    await executeBatchQueries(createHandle(execAsync), [42])

    expect(execAsync).toHaveBeenCalledTimes(8)
    expect(execAsync.mock.calls[7][1]).toMatchObject({
      bind: [null, 42],
    })
  })

  it('いずれかのバッチクエリが失敗した場合はエラーを呼び出し元へ返す', async () => {
    const execAsync = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('media query failed'))
      .mockResolvedValue([])

    await expect(
      executeBatchQueries(createHandle(execAsync), [1]),
    ).rejects.toThrow('media query failed')
    expect(execAsync).toHaveBeenCalledTimes(8)
  })
})
