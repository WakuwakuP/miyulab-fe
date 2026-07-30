import type { Entity } from 'megalodon'
import {
  editedAtMsToIso,
  mergeLocalReaction,
  parseBatchPoll,
  parseEmojiReactions,
  parseEmojis,
  parseInlinePoll,
  parseInteractions,
  parseMediaAttachments,
  parseMentions,
} from 'util/db/sqlite/queries/statusMapperParsers'
import type { InteractionsJson } from 'util/db/sqlite/queries/statusMapperTypes'
import { afterEach, describe, expect, it, vi } from 'vitest'

function makeInteractions(
  overrides: Partial<InteractionsJson> = {},
): InteractionsJson {
  return {
    is_bookmarked: 0,
    is_favourited: 0,
    is_muted: 0,
    is_pinned: 0,
    is_reblogged: 0,
    my_reaction_name: null,
    my_reaction_url: null,
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('parseEmojiReactions / parseInteractions', () => {
  it.each([null, ''])('空値 %s は空のリアクション配列にする', (json) => {
    expect(parseEmojiReactions(json)).toEqual([])
  })

  it('有効なリアクション JSON はそのまま復元する', () => {
    const reactions = [{ count: 2, me: false, name: 'blobcat' }]

    expect(parseEmojiReactions(JSON.stringify(reactions))).toEqual(reactions)
  })

  it('壊れたリアクション JSON は空配列へフォールバックする', () => {
    expect(parseEmojiReactions('{not-json')).toEqual([])
  })

  it.each([null, ''])(
    '空値 %s は interactions がないものとして扱う',
    (json) => {
      expect(parseInteractions(json)).toBeNull()
    },
  )

  it('有効な interactions JSON を復元する', () => {
    const interactions = makeInteractions({
      is_bookmarked: 1,
      my_reaction_name: '👍',
    })

    expect(parseInteractions(JSON.stringify(interactions))).toEqual(
      interactions,
    )
  })

  it('壊れた interactions JSON は null へフォールバックする', () => {
    expect(parseInteractions('not-json')).toBeNull()
  })
})

describe('mergeLocalReaction', () => {
  it('ローカルリアクションがなければ元の配列を変更しない', () => {
    const reactions = [{ count: 1, me: false, name: '👍' }] as Entity.Reaction[]

    expect(mergeLocalReaction(reactions, null)).toBe(reactions)
    expect(mergeLocalReaction(reactions, makeInteractions())).toBe(reactions)
  })

  it('コロンで囲まれた名前を正規化し、URL を補完して me を立てる', () => {
    const localUrl = 'https://example.com/emoji/blobcat.png'
    const reactions = [
      {
        count: 3,
        me: false,
        name: ':blobcat:',
        static_url: localUrl,
      },
    ] as Entity.Reaction[]

    expect(
      mergeLocalReaction(
        reactions,
        makeInteractions({
          my_reaction_name: 'blobcat',
          my_reaction_url: localUrl,
        }),
      ),
    ).toEqual([
      {
        count: 3,
        me: true,
        name: ':blobcat:',
        static_url: localUrl,
        url: localUrl,
      },
    ])
  })

  it('URL のない同名カスタム絵文字もローカル URL と同一として扱う', () => {
    const localUrl = 'https://example.com/emoji/blobcat.png'

    expect(
      mergeLocalReaction(
        [{ count: 1, me: false, name: 'blobcat' }] as Entity.Reaction[],
        makeInteractions({
          my_reaction_name: ':blobcat:',
          my_reaction_url: localUrl,
        }),
      ),
    ).toEqual([
      {
        count: 1,
        me: true,
        name: 'blobcat',
        static_url: localUrl,
        url: localUrl,
      },
    ])
  })

  it('同名でも URL が異なるカスタム絵文字は別リアクションとして追加する', () => {
    const original = {
      count: 4,
      me: false,
      name: 'blobcat',
      url: 'https://remote.example/blobcat.png',
    }
    const localUrl = 'https://local.example/blobcat.png'

    expect(
      mergeLocalReaction(
        [original] as Entity.Reaction[],
        makeInteractions({
          my_reaction_name: 'blobcat',
          my_reaction_url: localUrl,
        }),
      ),
    ).toEqual([
      original,
      {
        account_ids: [],
        count: 1,
        me: true,
        name: 'blobcat',
        static_url: localUrl,
        url: localUrl,
      },
    ])
  })

  it('Unicode リアクションは URL なしで一致し、不要な URL フィールドを足さない', () => {
    expect(
      mergeLocalReaction(
        [{ count: 5, me: false, name: '🔥' }] as Entity.Reaction[],
        makeInteractions({ my_reaction_name: '🔥' }),
      ),
    ).toEqual([{ count: 5, me: true, name: '🔥' }])
  })

  it('一致する名前がなければ Unicode リアクションを末尾に追加する', () => {
    expect(
      mergeLocalReaction(
        [{ count: 1, me: false, name: '👍' }] as Entity.Reaction[],
        makeInteractions({ my_reaction_name: '🔥' }),
      ),
    ).toEqual([
      { count: 1, me: false, name: '👍' },
      { account_ids: [], count: 1, me: true, name: '🔥' },
    ])
  })
})

describe('parseEmojis / parseMediaAttachments / parseMentions', () => {
  it('空値は各パーサーで空配列にする', () => {
    expect(parseEmojis(null)).toEqual([])
    expect(parseMediaAttachments('')).toEqual([])
    expect(parseMentions(null)).toEqual([])
  })

  it('絵文字の null 要素と shortcode 欠損を除外し、static URL を補完する', () => {
    const json = JSON.stringify([
      null,
      {
        shortcode: null,
        static_url: null,
        url: 'https://example.com/ignored.png',
        visible_in_picker: 1,
      },
      {
        shortcode: 'fallback',
        static_url: null,
        url: 'https://example.com/fallback.png',
        visible_in_picker: 1,
      },
      {
        shortcode: 'static',
        static_url: 'https://example.com/static.png',
        url: 'https://example.com/animated.gif',
        visible_in_picker: 0,
      },
    ])

    expect(parseEmojis(json)).toEqual([
      {
        shortcode: 'fallback',
        static_url: 'https://example.com/fallback.png',
        url: 'https://example.com/fallback.png',
        visible_in_picker: true,
      },
      {
        shortcode: 'static',
        static_url: 'https://example.com/static.png',
        url: 'https://example.com/animated.gif',
        visible_in_picker: false,
      },
    ])
  })

  it('メディア配列から null 要素だけを除外する', () => {
    const attachment = {
      id: 'media-1',
      preview_url: 'https://example.com/preview.png',
      type: 'image',
      url: 'https://example.com/image.png',
    }

    expect(
      parseMediaAttachments(JSON.stringify([null, attachment, null])),
    ).toEqual([attachment])
  })

  it('メンションの保存値を優先し、欠損値は acct から補う', () => {
    const json = JSON.stringify([
      null,
      {
        acct: 'alice@remote.example',
        url: 'https://remote.example/@alice',
        username: 'stored-alice',
      },
      { acct: 'bob@remote.example' },
      { acct: '' },
    ])

    expect(parseMentions(json)).toEqual([
      {
        acct: 'alice@remote.example',
        id: '',
        url: 'https://remote.example/@alice',
        username: 'stored-alice',
      },
      {
        acct: 'bob@remote.example',
        id: '',
        url: '',
        username: 'bob',
      },
      { acct: '', id: '', url: '', username: '' },
    ])
  })

  it.each([parseEmojis, parseMediaAttachments, parseMentions])(
    '%# の構造化 JSON パーサーは壊れた JSON を呼び出し元へ通知する',
    (parser) => {
      expect(() => parser('{not-json')).toThrow(SyntaxError)
    },
  )
})

describe('poll parsers', () => {
  it('インライン poll の文字列 options と過去の期限を復元する', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-01-15T00:00:00.000Z')

    const poll = parseInlinePoll(
      JSON.stringify({
        expires_at: '2026-01-14T23:59:59.000Z',
        id: 10,
        multiple: 1,
        options: JSON.stringify([
          { title: 'A', votes_count: 2 },
          { title: 'B', votes_count: null },
        ]),
        votes_count: 2,
      }),
    )

    expect(poll).toEqual({
      expired: true,
      expires_at: '2026-01-14T23:59:59.000Z',
      id: '10',
      multiple: true,
      options: [
        { title: 'A', votes_count: 2 },
        { title: 'B', votes_count: null },
      ],
      voted: false,
      votes_count: 2,
    })
  })

  it('インライン poll の配列 options と期限なしを復元する', () => {
    const poll = parseInlinePoll(
      JSON.stringify({
        expires_at: null,
        id: 11,
        multiple: 0,
        options: [{ title: 'Only', votes_count: 0 }],
        votes_count: 0,
      }),
    )

    expect(poll.expired).toBe(false)
    expect(poll.multiple).toBe(false)
    expect(poll.options).toEqual([{ title: 'Only', votes_count: 0 }])
    expect(poll).not.toHaveProperty('own_votes')
  })

  it('batch poll は DB の expired/voted と JSON 文字列の own_votes を優先する', () => {
    const poll = parseBatchPoll(
      JSON.stringify({
        expired: 1,
        expires_at: '2099-01-01T00:00:00.000Z',
        id: 20,
        multiple: 1,
        options: JSON.stringify([{ title: 'A', votes_count: 4 }]),
        own_votes: '[0,2]',
        voted: 1,
        votes_count: 4,
      }),
    )

    expect(poll).toMatchObject({
      expired: true,
      id: '20',
      multiple: true,
      options: [{ title: 'A', votes_count: 4 }],
      own_votes: [0, 2],
      voted: true,
    })
  })

  it('batch poll は expired=0 を期限日時より優先し、配列 own_votes を保つ', () => {
    const poll = parseBatchPoll(
      JSON.stringify({
        expired: 0,
        expires_at: '2000-01-01T00:00:00.000Z',
        id: 21,
        multiple: 0,
        options: [{ title: 'A', votes_count: null }],
        own_votes: [1],
        voted: 0,
        votes_count: 0,
      }),
    )

    expect(poll.expired).toBe(false)
    expect(poll.multiple).toBe(false)
    expect(poll).toMatchObject({ own_votes: [1] })
    expect(poll.voted).toBe(false)
  })

  it('batch poll は expired が null なら日時から期限切れを判定する', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-01-15T00:00:00.000Z')

    const expired = parseBatchPoll(
      JSON.stringify({
        expired: null,
        expires_at: '2026-01-14T00:00:00.000Z',
        id: 22,
        multiple: 0,
        options: [],
        own_votes: null,
        voted: null,
        votes_count: 0,
      }),
    )
    const openEnded = parseBatchPoll(
      JSON.stringify({
        expired: null,
        expires_at: null,
        id: 23,
        multiple: 0,
        options: [],
        own_votes: null,
        voted: null,
        votes_count: 0,
      }),
    )

    expect(expired.expired).toBe(true)
    expect(openEnded.expired).toBe(false)
    expect(openEnded).not.toHaveProperty('own_votes')
  })

  it('壊れた own_votes だけを無視し、poll 本体は復元する', () => {
    const poll = parseBatchPoll(
      JSON.stringify({
        expired: null,
        expires_at: null,
        id: 24,
        multiple: 0,
        options: [],
        own_votes: 'not-json',
        voted: 1,
        votes_count: 1,
      }),
    )

    expect(poll.voted).toBe(true)
    expect(poll).not.toHaveProperty('own_votes')
  })

  it.each([parseInlinePoll, parseBatchPoll])(
    '%# は壊れた poll JSON を呼び出し元へ通知する',
    (parser) => {
      expect(() => parser('{not-json')).toThrow(SyntaxError)
    },
  )
})

describe('editedAtMsToIso', () => {
  it('ミリ秒を ISO 文字列へ変換し、null は維持する', () => {
    expect(editedAtMsToIso(1_700_001_000_000)).toBe('2023-11-14T22:30:00.000Z')
    expect(editedAtMsToIso(null)).toBeNull()
  })
})
