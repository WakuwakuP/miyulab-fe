import {
  buildBatchMapsFromResults,
  executeBatchQueries,
  replacePlaceholders,
  type SqliteHandle,
} from 'util/db/sqlite/queries/statusBatch'
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
