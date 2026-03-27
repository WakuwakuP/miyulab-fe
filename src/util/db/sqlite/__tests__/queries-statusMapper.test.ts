/**
 * statusMapper.ts のユニットテスト
 *
 * STATUS_SELECT / STATUS_BASE_SELECT の新カラム順序に対応した
 * rowToStoredStatus / assembleStatusFromBatch の動作を検証する。
 */

import type { BatchMaps } from 'util/db/sqlite/queries/statusBatch'
import {
  assembleStatusFromBatch,
  rowToStoredStatus,
} from 'util/db/sqlite/queries/statusMapper'
import { describe, expect, it } from 'vitest'

// ─── helpers ────────────────────────────────────────────────────

/**
 * STATUS_SELECT 用の行を生成する（66 カラム: indices 0–65）
 *
 * 新レイアウト:
 *   [0]  post_id          [1]  backendUrl       [2]  local_id
 *   [3]  created_at_ms    [4]  object_uri
 *   [5]  content_html     [6]  spoiler_text     [7]  canonical_url
 *   [8]  language         [9]  visibility_code  [10] is_sensitive
 *   [11] is_reblog        [12] in_reply_to_id
 *   [13] edited_at_ms     [14] author_acct      [15] author_username
 *   [16] author_display   [17] author_avatar    [18] author_header
 *   [19] author_locked    [20] author_bot       [21] author_url
 *   [22] replies_count    [23] reblogs_count    [24] favourites_count
 *   [25] engagements_csv  [26] media_json       [27] mentions_json
 *   [28] timelineTypes    [29] belongingTags
 *   [30] status_emojis_json [31] account_emojis_json
 *   [32] poll_json
 *   [33] rb_post_id       [34] rb_content_html  [35] rb_spoiler_text
 *   [36] rb_canonical_url [37] rb_language      [38] rb_visibility_code
 *   [39] rb_is_sensitive  [40] rb_in_reply_to_id
 *   [41] rb_edited_at_ms  [42] rb_created_at_ms [43] rb_object_uri
 *   [44] rb_author_acct   [45] rb_author_username
 *   [46] rb_author_display [47] rb_author_avatar [48] rb_author_header
 *   [49] rb_author_locked [50] rb_author_bot    [51] rb_author_url
 *   [52] rb_replies_count [53] rb_reblogs_count [54] rb_favourites_count
 *   [55] rb_engagements_csv [56] rb_media_json  [57] rb_mentions_json
 *   [58] rb_status_emojis_json [59] rb_account_emojis_json
 *   [60] rb_poll_json     [61] rb_local_id
 *   [62] author_account_id [63] rb_author_account_id
 *   [64] emoji_reactions_json [65] rb_emoji_reactions_json
 */
function makeRow(): (string | number | null)[] {
  const row: (string | number | null)[] = new Array(66).fill(null)
  // 最低限のデフォルト値（nullish-safety）
  row[0] = 42 // post_id
  row[1] = 'https://example.com' // backendUrl
  row[2] = '12345' // local_id
  row[3] = 1700000000000 // created_at_ms
  row[4] = 'https://example.com/users/alice/statuses/12345' // object_uri
  row[5] = '<p>Hello</p>' // content_html
  row[6] = '' // spoiler_text
  row[7] = 'https://example.com/@alice/12345' // canonical_url
  row[8] = 'en' // language
  row[9] = 'public' // visibility_code
  row[10] = 0 // is_sensitive
  row[11] = 0 // is_reblog
  row[12] = null // in_reply_to_id
  row[13] = null // edited_at_ms
  row[14] = 'alice' // author_acct
  row[15] = 'alice' // author_username
  row[16] = 'Alice' // author_display_name
  row[17] = 'https://example.com/avatar.png' // author_avatar
  row[18] = 'https://example.com/header.png' // author_header
  row[19] = 0 // author_locked
  row[20] = 0 // author_bot
  row[21] = 'https://example.com/@alice' // author_url
  row[22] = 3 // replies_count
  row[23] = 5 // reblogs_count
  row[24] = 10 // favourites_count
  row[25] = null // engagements_csv
  row[62] = '' // author_account_id
  return row
}

/**
 * STATUS_BASE_SELECT 用の行を生成する（52 カラム: indices 0–51）
 *
 * 新レイアウト:
 *   [0]  post_id         [1]  backendUrl       [2]  local_id
 *   [3]  created_at_ms   [4]  object_uri
 *   [5]  content_html    [6]  spoiler_text     [7]  canonical_url
 *   [8]  language        [9]  visibility_code  [10] is_sensitive
 *   [11] is_reblog       [12] in_reply_to_id
 *   [13] edited_at_ms    [14] author_acct      [15] author_username
 *   [16] author_display  [17] author_avatar    [18] author_header
 *   [19] author_locked   [20] author_bot       [21] author_url
 *   [22] replies_count   [23] reblogs_count    [24] favourites_count
 *   [25] rb_post_id      ... [46] rb_favourites_count
 *   [47] rb_local_id     [48] author_account_id [49] rb_author_account_id
 *   [50] emoji_reactions_json [51] rb_emoji_reactions_json
 */
function makeBaseRow(): (string | number | null)[] {
  const row: (string | number | null)[] = new Array(52).fill(null)
  row[0] = 42 // post_id
  row[1] = 'https://example.com' // backendUrl
  row[2] = '12345' // local_id
  row[3] = 1700000000000 // created_at_ms
  row[4] = 'https://example.com/users/alice/statuses/12345' // object_uri
  row[5] = '<p>Hello</p>' // content_html
  row[6] = '' // spoiler_text
  row[7] = 'https://example.com/@alice/12345' // canonical_url
  row[8] = 'en' // language
  row[9] = 'public' // visibility_code
  row[10] = 0 // is_sensitive
  row[11] = 0 // is_reblog
  row[12] = null // in_reply_to_id
  row[13] = null // edited_at_ms
  row[14] = 'alice' // author_acct
  row[15] = 'alice' // author_username
  row[16] = 'Alice' // author_display_name
  row[17] = 'https://example.com/avatar.png' // author_avatar
  row[18] = 'https://example.com/header.png' // author_header
  row[19] = 0 // author_locked
  row[20] = 0 // author_bot
  row[21] = 'https://example.com/@alice' // author_url
  row[22] = 3 // replies_count
  row[23] = 5 // reblogs_count
  row[24] = 10 // favourites_count
  row[48] = '' // author_account_id
  return row
}

/** 空の BatchMaps を生成する */
function makeMaps(overrides: Partial<BatchMaps> = {}): BatchMaps {
  return {
    belongingTagsMap: new Map(),
    customEmojisMap: new Map(),
    emojiReactionsMap: new Map(),
    interactionsMap: new Map(),
    mediaMap: new Map(),
    mentionsMap: new Map(),
    pollsMap: new Map(),
    timelineTypesMap: new Map(),
    ...overrides,
  }
}

// ─── rowToStoredStatus ──────────────────────────────────────────

describe('rowToStoredStatus', () => {
  it('rowToStoredStatus が正しいカラムインデックスでデータを抽出する', () => {
    const row = makeRow()
    const result = rowToStoredStatus(row)

    // 基本フィールド
    expect(result.post_id).toBe(42)
    expect(result.backendUrl).toBe('https://example.com')
    expect(result.id).toBe('12345') // local_id → id
    expect(result.created_at).toBe(new Date(1700000000000).toISOString())
    expect(result.created_at_ms).toBe(1700000000000)
    expect(result.uri).toBe('https://example.com/users/alice/statuses/12345') // object_uri
    expect(result.content).toBe('<p>Hello</p>') // content_html
    expect(result.spoiler_text).toBe('')
    expect(result.url).toBe('https://example.com/@alice/12345') // canonical_url
    expect(result.language).toBe('en')
    expect(result.sensitive).toBe(false) // is_sensitive=0
    expect(result.in_reply_to_id).toBeNull()

    // カウント
    expect(result.replies_count).toBe(3) // [22]
    expect(result.reblogs_count).toBe(5) // [23]
    expect(result.favourites_count).toBe(10) // [24]

    // アカウント
    expect(result.account.acct).toBe('alice') // [14]
    expect(result.account.username).toBe('alice') // [15]
    expect(result.account.display_name).toBe('Alice') // [16]
    expect(result.account.avatar).toBe('https://example.com/avatar.png') // [17]
    expect(result.account.header).toBe('https://example.com/header.png') // [18]
    expect(result.account.locked).toBe(false) // [19]
    expect(result.account.bot).toBe(false) // [20]
    expect(result.account.url).toBe('https://example.com/@alice') // [21]

    // リブログなし
    expect(result.reblog).toBeNull()

    // storedAt が存在しない
    expect(result).not.toHaveProperty('storedAt')
  })

  it('edited_at_ms を ISO 文字列に変換する', () => {
    const row = makeRow()
    const editedMs = 1700001000000
    row[13] = editedMs // edited_at_ms (INTEGER)

    const result = rowToStoredStatus(row)

    expect(result.edited_at).toBe(new Date(editedMs).toISOString())
    expect(result.edited_at_ms).toBe(editedMs)
  })

  it('edited_at_ms が null の場合 null を返す', () => {
    const row = makeRow()
    row[13] = null // edited_at_ms

    const result = rowToStoredStatus(row)

    expect(result.edited_at).toBeNull()
    expect(result.edited_at_ms).toBeNull()
  })

  it('backendUrl を local_accounts.backend_url から取得する', () => {
    const row = makeRow()
    row[1] = 'https://mastodon.social' // local_accounts.backend_url

    const result = rowToStoredStatus(row)

    expect(result.backendUrl).toBe('https://mastodon.social')
  })

  it('account.id が空文字列を返す（profile_aliases 廃止）', () => {
    const row = makeRow()
    // author_account_id [62] にどんな値が入っていても id は空文字列
    row[62] = 'should-be-ignored'

    const result = rowToStoredStatus(row)

    expect(result.account.id).toBe('')
  })

  it('visibility を vt.name から取得する', () => {
    const row = makeRow()
    row[9] = 'unlisted' // vt.name

    const result = rowToStoredStatus(row)

    expect(result.visibility).toBe('unlisted')
  })
})

// ─── assembleStatusFromBatch ────────────────────────────────────

describe('assembleStatusFromBatch', () => {
  it('assembleStatusFromBatch が interactionsMap を使用する', () => {
    const row = makeBaseRow()
    const postId = row[0] as number

    // interactionsMap に JSON 形式のフラグを設定
    const interactionsJson = JSON.stringify({
      is_bookmarked: 1,
      is_favourited: 1,
      is_muted: 0,
      is_pinned: 0,
      is_reblogged: 0,
      my_reaction_name: null,
      my_reaction_url: null,
    })
    const maps = makeMaps({
      interactionsMap: new Map([[postId, interactionsJson]]),
    })

    const result = assembleStatusFromBatch(row, maps)

    expect(result.favourited).toBe(true)
    expect(result.reblogged).toBe(false)
    expect(result.bookmarked).toBe(true)
  })

  it('assembleStatusFromBatch が mentions に username と url を含める', () => {
    const row = makeBaseRow()
    const postId = row[0] as number

    const mentionsJson = JSON.stringify([
      {
        acct: 'bob@remote.example',
        url: 'https://remote.example/@bob',
        username: 'bob',
      },
      { acct: 'carol', url: 'https://example.com/@carol', username: 'carol' },
    ])
    const maps = makeMaps({
      mentionsMap: new Map([[postId, mentionsJson]]),
    })

    const result = assembleStatusFromBatch(row, maps)

    expect(result.mentions).toHaveLength(2)
    expect(result.mentions[0]).toEqual({
      acct: 'bob@remote.example',
      id: '',
      url: 'https://remote.example/@bob',
      username: 'bob',
    })
    expect(result.mentions[1]).toEqual({
      acct: 'carol',
      id: '',
      url: 'https://example.com/@carol',
      username: 'carol',
    })
  })
})
