import type { Entity } from 'megalodon'
import type { BatchMaps } from 'util/db/sqlite/queries/statusBatch'
import {
  assembleStatusFromBatch,
  rowToStoredStatus,
  toStoredStatus,
} from 'util/db/sqlite/queries/statusMapper'
import type { InteractionsJson } from 'util/db/sqlite/queries/statusMapperTypes'
import { describe, expect, it } from 'vitest'

type SqlValue = string | number | null

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

function makeInlineRow(): SqlValue[] {
  const row: SqlValue[] = new Array(66).fill(null)
  Object.assign(row, {
    0: 42,
    1: 'https://example.com',
    2: 'status-42',
    3: 1_700_000_000_000,
    4: 'https://example.com/objects/42',
    5: '<p>Hello</p>',
    6: '',
    7: 'https://example.com/@alice/42',
    8: 'ja',
    9: 'public',
    10: 0,
    11: 0,
    14: 'alice@example.com',
    15: 'alice',
    16: 'Alice',
    17: 'https://example.com/alice-avatar.png',
    18: 'https://example.com/alice-header.png',
    19: 0,
    20: 0,
    21: 'https://example.com/@alice',
    22: 1,
    23: 2,
    24: 3,
  })
  return row
}

function makeBatchRow(): SqlValue[] {
  const row: SqlValue[] = new Array(52).fill(null)
  Object.assign(row, {
    0: 42,
    1: 'https://example.com',
    2: 'status-42',
    3: 1_700_000_000_000,
    4: 'https://example.com/objects/42',
    5: '<p>Hello</p>',
    6: '',
    7: 'https://example.com/@alice/42',
    8: 'ja',
    9: 'public',
    10: 0,
    11: 0,
    14: 'alice@example.com',
    15: 'alice',
    16: 'Alice',
    17: 'https://example.com/alice-avatar.png',
    18: 'https://example.com/alice-header.png',
    19: 0,
    20: 0,
    21: 'https://example.com/@alice',
    22: 1,
    23: 2,
    24: 3,
  })
  return row
}

function makeMaps(overrides: Partial<BatchMaps> = {}): BatchMaps {
  return {
    belongingTagsMap: new Map(),
    customEmojisMap: new Map(),
    emojiReactionsMap: new Map(),
    interactionsMap: new Map(),
    mediaMap: new Map(),
    mentionsMap: new Map(),
    pollsMap: new Map(),
    profileEmojisMap: new Map(),
    timelineTypesMap: new Map(),
    ...overrides,
  }
}

const mediaJson = JSON.stringify([
  null,
  {
    id: 'media-1',
    preview_url: 'https://example.com/preview.png',
    type: 'image',
    url: 'https://example.com/image.png',
  },
])
const mentionsJson = JSON.stringify([
  {
    acct: 'bob@remote.example',
    url: 'https://remote.example/@bob',
    username: 'bob',
  },
])
const customEmojisJson = JSON.stringify([
  {
    shortcode: 'wave',
    static_url: null,
    url: 'https://example.com/wave.gif',
    visible_in_picker: 1,
  },
])
const profileEmojisJson = JSON.stringify([
  {
    shortcode: 'verified',
    static_url: 'https://example.com/verified.png',
    url: 'https://example.com/verified.gif',
    visible_in_picker: 0,
  },
])
const inlinePollJson = JSON.stringify({
  expires_at: null,
  id: 5,
  multiple: 0,
  options: [{ title: 'yes', votes_count: 2 }],
  votes_count: 2,
})
const batchPollJson = JSON.stringify({
  expired: 0,
  expires_at: null,
  id: 5,
  multiple: 0,
  options: [{ title: 'yes', votes_count: 2 }],
  own_votes: '[0]',
  voted: 1,
  votes_count: 2,
})

describe('rowToStoredStatus branch behavior', () => {
  it('関連 JSON、タグ、poll、interaction と真偽値をまとめて復元する', () => {
    const row = makeInlineRow()
    row[10] = 1
    row[19] = 1
    row[20] = 1
    row[25] = JSON.stringify(
      makeInteractions({
        is_bookmarked: 1,
        is_favourited: 1,
        is_reblogged: 1,
      }),
    )
    row[26] = mediaJson
    row[27] = mentionsJson
    row[28] = JSON.stringify(['home', null, 'tag'])
    row[29] = JSON.stringify(['cats', null, 'fediverse'])
    row[30] = customEmojisJson
    row[31] = profileEmojisJson
    row[32] = inlinePollJson

    const status = rowToStoredStatus(row)

    expect(status).toMatchObject({
      belongingTags: ['cats', 'fediverse'],
      bookmarked: true,
      favourited: true,
      reblogged: true,
      sensitive: true,
      timelineTypes: ['home', 'tag'],
    })
    expect(status.tags).toEqual([
      { name: 'cats', url: '' },
      { name: 'fediverse', url: '' },
    ])
    expect(status.account).toMatchObject({
      bot: true,
      emojis: [
        {
          shortcode: 'verified',
          static_url: 'https://example.com/verified.png',
          url: 'https://example.com/verified.gif',
          visible_in_picker: false,
        },
      ],
      locked: true,
    })
    expect(status.emojis).toHaveLength(1)
    expect(status.media_attachments).toHaveLength(1)
    expect(status.mentions).toHaveLength(1)
    expect(status.poll).toMatchObject({
      id: '5',
      options: [{ title: 'yes', votes_count: 2 }],
      voted: false,
    })
  })

  it('旧 CSV engagement を後方互換として解釈する', () => {
    const row = makeInlineRow()
    row[25] = 'favourite,reblog,bookmark'

    const status = rowToStoredStatus(row)

    expect(status.favourited).toBe(true)
    expect(status.reblogged).toBe(true)
    expect(status.bookmarked).toBe(true)
  })

  it('壊れた interactions は false へフォールバックする', () => {
    const row = makeInlineRow()
    row[25] = '{not-json'

    const status = rowToStoredStatus(row)

    expect(status.favourited).toBe(false)
    expect(status.reblogged).toBe(false)
    expect(status.bookmarked).toBe(false)
  })

  it('is_reblog が真でも元投稿 ID がなければ reblog を作らない', () => {
    const row = makeInlineRow()
    row[11] = 1
    row[33] = null

    expect(rowToStoredStatus(row).reblog).toBeNull()
  })

  it('リブログ元の全関連データと旧 CSV engagement を復元する', () => {
    const row = makeInlineRow()
    row[11] = 1
    Object.assign(row, {
      33: 77,
      34: '<p>Boosted</p>',
      35: 'CW',
      36: 'https://remote.example/@bob/77',
      37: 'en',
      38: 'unlisted',
      39: 1,
      40: 'reply-1',
      41: 1_700_000_100_000,
      42: 1_699_999_900_000,
      43: 'https://remote.example/objects/77',
      44: 'bob@remote.example',
      45: 'bob',
      46: 'Bob',
      47: 'https://remote.example/bob-avatar.png',
      48: 'https://remote.example/bob-header.png',
      49: 1,
      50: 1,
      51: 'https://remote.example/@bob',
      52: 4,
      53: 5,
      54: 6,
      55: 'favourite,reblog,bookmark',
      56: mediaJson,
      57: mentionsJson,
      58: customEmojisJson,
      59: profileEmojisJson,
      60: inlinePollJson,
      61: 'remote-77',
      65: '{not-json',
    })

    const reblog = rowToStoredStatus(row).reblog

    expect(reblog).toMatchObject({
      bookmarked: true,
      content: '<p>Boosted</p>',
      created_at: new Date(1_699_999_900_000).toISOString(),
      edited_at: new Date(1_700_000_100_000).toISOString(),
      emoji_reactions: [],
      favourited: true,
      favourites_count: 6,
      id: 'remote-77',
      in_reply_to_id: 'reply-1',
      language: 'en',
      reblog: null,
      reblogged: true,
      reblogs_count: 5,
      replies_count: 4,
      sensitive: true,
      spoiler_text: 'CW',
      uri: 'https://remote.example/objects/77',
      url: 'https://remote.example/@bob/77',
      visibility: 'unlisted',
    })
    expect(reblog?.account).toMatchObject({
      acct: 'bob@remote.example',
      bot: true,
      locked: true,
      username: 'bob',
    })
    expect(reblog?.emojis).toHaveLength(1)
    expect(reblog?.account.emojis).toHaveLength(1)
    expect(reblog?.media_attachments).toHaveLength(1)
    expect(reblog?.mentions).toHaveLength(1)
    expect(reblog?.poll?.id).toBe('5')
  })

  it('リブログ元の nullable SQL カラムに API 互換の既定値を設定する', () => {
    const row = makeInlineRow()
    row[11] = 1
    row[33] = 77

    const reblog = rowToStoredStatus(row).reblog

    expect(reblog).toMatchObject({
      content: '',
      created_at: '',
      edited_at: null,
      favourites_count: 0,
      id: '',
      poll: null,
      reblogs_count: 0,
      replies_count: 0,
      spoiler_text: '',
      uri: '',
      visibility: 'public',
    })
    expect(reblog?.url).toBeUndefined()
    expect(reblog?.account).toMatchObject({
      acct: '',
      avatar: '',
      display_name: '',
      header: '',
      url: '',
      username: '',
    })
  })

  it('nullable SQL カラムに API 互換の既定値を設定する', () => {
    const row = makeInlineRow()
    for (const index of [
      1, 2, 4, 5, 6, 7, 8, 9, 14, 15, 16, 17, 18, 21, 22, 23, 24,
    ]) {
      row[index] = null
    }

    const status = rowToStoredStatus(row)

    expect(status).toMatchObject({
      backendUrl: '',
      content: '',
      favourites_count: 0,
      id: '',
      language: null,
      reblogs_count: 0,
      replies_count: 0,
      spoiler_text: '',
      uri: '',
      visibility: 'public',
    })
    expect(status.url).toBeUndefined()
    expect(status.account).toMatchObject({
      acct: '',
      avatar: '',
      display_name: '',
      header: '',
      url: '',
      username: '',
    })
  })
})

describe('assembleStatusFromBatch branch behavior', () => {
  it('全バッチ Map を使ってメイン投稿を構築する', () => {
    const row = makeBatchRow()
    row[10] = 1
    row[13] = 1_700_000_100_000
    row[19] = 1
    row[20] = 1
    row[50] = '{not-json'
    const maps = makeMaps({
      belongingTagsMap: new Map([
        [42, JSON.stringify(['cats', null, 'fediverse'])],
      ]),
      customEmojisMap: new Map([[42, customEmojisJson]]),
      interactionsMap: new Map([
        [
          42,
          JSON.stringify(
            makeInteractions({
              is_bookmarked: 1,
              is_favourited: 1,
              is_reblogged: 1,
            }),
          ),
        ],
      ]),
      mediaMap: new Map([[42, mediaJson]]),
      mentionsMap: new Map([[42, mentionsJson]]),
      pollsMap: new Map([[42, batchPollJson]]),
      profileEmojisMap: new Map([[42, profileEmojisJson]]),
      timelineTypesMap: new Map([
        [42, JSON.stringify(['home', null, 'local'])],
      ]),
    })

    const status = assembleStatusFromBatch(row, maps)

    expect(status).toMatchObject({
      belongingTags: ['cats', 'fediverse'],
      bookmarked: true,
      edited_at: new Date(1_700_000_100_000).toISOString(),
      emoji_reactions: [],
      favourited: true,
      reblogged: true,
      sensitive: true,
      timelineTypes: ['home', 'local'],
    })
    expect(status.account).toMatchObject({ bot: true, locked: true })
    expect(status.account.emojis).toHaveLength(1)
    expect(status.emojis).toHaveLength(1)
    expect(status.media_attachments).toHaveLength(1)
    expect(status.mentions).toHaveLength(1)
    expect(status.poll).toMatchObject({ own_votes: [0], voted: true })
    expect(status.tags).toEqual([
      { name: 'cats', url: '' },
      { name: 'fediverse', url: '' },
    ])
  })

  it('is_reblog が真でも元投稿 ID がなければ reblog を作らない', () => {
    const row = makeBatchRow()
    row[11] = 1
    row[25] = null

    expect(assembleStatusFromBatch(row, makeMaps()).reblog).toBeNull()
  })

  it('リブログ元のバッチ Map、poll、リアクションを復元する', () => {
    const row = makeBatchRow()
    row[11] = 1
    Object.assign(row, {
      25: 77,
      26: '<p>Boosted</p>',
      27: 'CW',
      28: 'https://remote.example/@bob/77',
      29: 'en',
      30: 'private',
      31: 1,
      32: 'reply-1',
      33: 1_700_000_100_000,
      34: 1_699_999_900_000,
      35: 'https://remote.example/objects/77',
      36: 'bob@remote.example',
      37: 'bob',
      38: 'Bob',
      39: 'https://remote.example/bob-avatar.png',
      40: 'https://remote.example/bob-header.png',
      41: 1,
      42: 1,
      43: 'https://remote.example/@bob',
      44: 4,
      45: 5,
      46: 6,
      47: 'remote-77',
      51: JSON.stringify([{ count: 2, me: false, name: '🔥' }]),
    })
    const maps = makeMaps({
      customEmojisMap: new Map([[77, customEmojisJson]]),
      interactionsMap: new Map([
        [
          77,
          JSON.stringify(
            makeInteractions({
              is_bookmarked: 1,
              is_favourited: 1,
              is_reblogged: 1,
              my_reaction_name: '🔥',
            }),
          ),
        ],
      ]),
      mediaMap: new Map([[77, mediaJson]]),
      mentionsMap: new Map([[77, mentionsJson]]),
      pollsMap: new Map([[77, batchPollJson]]),
      profileEmojisMap: new Map([[77, profileEmojisJson]]),
    })

    const reblog = assembleStatusFromBatch(row, maps).reblog

    expect(reblog).toMatchObject({
      bookmarked: true,
      content: '<p>Boosted</p>',
      created_at: new Date(1_699_999_900_000).toISOString(),
      edited_at: new Date(1_700_000_100_000).toISOString(),
      emoji_reactions: [{ count: 2, me: true, name: '🔥' }],
      favourited: true,
      id: 'remote-77',
      poll: { own_votes: [0], voted: true },
      reblogged: true,
      sensitive: true,
      visibility: 'private',
    })
    expect(reblog?.account).toMatchObject({
      acct: 'bob@remote.example',
      bot: true,
      locked: true,
    })
    expect(reblog?.account.emojis).toHaveLength(1)
    expect(reblog?.emojis).toHaveLength(1)
    expect(reblog?.media_attachments).toHaveLength(1)
    expect(reblog?.mentions).toHaveLength(1)
  })

  it('リブログ元の nullable カラムに既定値を設定する', () => {
    const row = makeBatchRow()
    row[11] = 1
    row[25] = 77

    const reblog = assembleStatusFromBatch(row, makeMaps()).reblog

    expect(reblog).toMatchObject({
      bookmarked: false,
      content: '',
      created_at: '',
      edited_at: null,
      favourited: false,
      favourites_count: 0,
      id: '',
      reblogged: false,
      reblogs_count: 0,
      replies_count: 0,
      spoiler_text: '',
      uri: '',
      visibility: 'public',
    })
    expect(reblog?.url).toBeUndefined()
    expect(reblog?.account).toMatchObject({
      acct: '',
      avatar: '',
      display_name: '',
      header: '',
      url: '',
      username: '',
    })
  })

  it('メイン投稿の nullable カラムに API 互換の既定値を設定する', () => {
    const row = makeBatchRow()
    for (const index of [
      1, 2, 4, 5, 6, 7, 8, 9, 14, 15, 16, 17, 18, 21, 22, 23, 24,
    ]) {
      row[index] = null
    }

    const status = assembleStatusFromBatch(row, makeMaps())

    expect(status).toMatchObject({
      backendUrl: '',
      content: '',
      favourites_count: 0,
      id: '',
      language: null,
      reblogs_count: 0,
      replies_count: 0,
      spoiler_text: '',
      uri: '',
      visibility: 'public',
    })
    expect(status.url).toBeUndefined()
    expect(status.account).toMatchObject({
      acct: '',
      avatar: '',
      display_name: '',
      header: '',
      url: '',
      username: '',
    })
  })
})

describe('toStoredStatus', () => {
  it('Entity.Status に DB 用メタデータとタグ名・時刻を追加する', () => {
    const status = {
      created_at: '2023-11-14T22:13:20.000Z',
      edited_at: '2023-11-14T22:15:00.000Z',
      id: 'remote-id',
      tags: [
        { name: 'cats', url: 'https://example.com/tags/cats' },
        { name: 'fediverse', url: 'https://example.com/tags/fediverse' },
      ],
    } as Entity.Status

    const stored = toStoredStatus(status, 'https://example.com', [
      'home',
      'tag',
    ])

    expect(stored).toMatchObject({
      backendUrl: 'https://example.com',
      belongingTags: ['cats', 'fediverse'],
      created_at_ms: 1_700_000_000_000,
      edited_at_ms: 1_700_000_100_000,
      id: 'remote-id',
      post_id: 0,
      timelineTypes: ['home', 'tag'],
    })
  })

  it('編集日時がない status は edited_at_ms を null にする', () => {
    const status = {
      created_at: '2023-11-14T22:13:20.000Z',
      edited_at: null,
      tags: [],
    } as unknown as Entity.Status

    expect(toStoredStatus(status, 'https://example.com', []).edited_at_ms).toBe(
      null,
    )
  })
})
