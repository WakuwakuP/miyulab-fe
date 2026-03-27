import {
  NOTIFICATION_BASE_JOINS,
  NOTIFICATION_SELECT,
  rowToStoredNotification,
} from 'util/db/sqlite/notificationStore'
import { describe, expect, it } from 'vitest'

// ─── NOTIFICATION_SELECT クエリ文字列のテスト ───────────────────

describe('NOTIFICATION_SELECT', () => {
  it('profile_aliases が含まれていない', () => {
    expect(NOTIFICATION_SELECT).not.toContain('profile_aliases')
    expect(NOTIFICATION_BASE_JOINS).not.toContain('profile_aliases')
  })

  it('local_accounts が含まれている', () => {
    expect(NOTIFICATION_BASE_JOINS).toContain('local_accounts')
    expect(NOTIFICATION_BASE_JOINS).toContain(
      'la ON n.local_account_id = la.id',
    )
    // 旧スキーマの servers JOIN は使わない
    expect(NOTIFICATION_BASE_JOINS).not.toContain(
      'sv ON n.server_id = sv.server_id',
    )
  })

  it('notification_types.name を使用する（code ではない）', () => {
    expect(NOTIFICATION_SELECT).toContain('nt.name')
    expect(NOTIFICATION_SELECT).not.toContain('nt.code')
    // JOIN 条件も新スキーマの id を使う
    expect(NOTIFICATION_BASE_JOINS).toContain('nt.id')
    expect(NOTIFICATION_BASE_JOINS).not.toContain('nt.notification_type_id')
  })

  it('post_mentions を使用する（posts_mentions ではない）', () => {
    expect(NOTIFICATION_SELECT).toContain('post_mentions')
    expect(NOTIFICATION_SELECT).not.toContain('posts_mentions')
  })

  it('custom_emojis.url を使用する（image_url ではない）', () => {
    expect(NOTIFICATION_SELECT).toContain('ce.url')
    expect(NOTIFICATION_SELECT).not.toContain('ce.image_url')
  })

  it('posts.id を使用する（post_id ではない）', () => {
    // JOIN 条件
    expect(NOTIFICATION_BASE_JOINS).toContain('rp ON n.related_post_id = rp.id')
    expect(NOTIFICATION_BASE_JOINS).not.toContain('rp.post_id')
    // SELECT 句内の rp 参照
    expect(NOTIFICATION_SELECT).toContain('rp.id AS rp_post_id')
    expect(NOTIFICATION_SELECT).not.toMatch(/\brp\.post_id\b/)
  })

  it('sort_order を使用する（option_index ではない）', () => {
    expect(NOTIFICATION_SELECT).toContain('sort_order')
    expect(NOTIFICATION_SELECT).not.toContain('option_index')
  })

  it('n.id を使用する（n.notification_id ではない）', () => {
    expect(NOTIFICATION_SELECT).toContain('n.id')
    expect(NOTIFICATION_SELECT).not.toContain('n.notification_id')
  })

  it('stored_at が含まれていない', () => {
    expect(NOTIFICATION_SELECT).not.toContain('n.stored_at')
  })

  it('post_custom_emojis.custom_emoji_id を使用する（emoji_id ではない）', () => {
    expect(NOTIFICATION_SELECT).toContain('pce.custom_emoji_id')
    expect(NOTIFICATION_SELECT).not.toMatch(/pce\.emoji_id\b/)
  })

  it('custom_emojis.id を JOIN に使用する（emoji_id ではない）', () => {
    expect(NOTIFICATION_SELECT).toContain('ce.id')
    expect(NOTIFICATION_SELECT).not.toMatch(/ce\.emoji_id\b/)
  })

  it('has_media の代わりに EXISTS サブクエリを使用する', () => {
    expect(NOTIFICATION_SELECT).not.toContain('rp.has_media')
    expect(NOTIFICATION_SELECT).toContain('EXISTS')
    expect(NOTIFICATION_SELECT).toContain('post_media')
  })

  it('post_backend_ids を使用する（posts_backends ではない）', () => {
    expect(NOTIFICATION_SELECT).toContain('post_backend_ids')
    expect(NOTIFICATION_SELECT).not.toContain('posts_backends')
  })

  it('visibility_types.name を使用する（code ではない）', () => {
    expect(NOTIFICATION_SELECT).toContain('vt2.name')
    expect(NOTIFICATION_SELECT).not.toContain('vt2.code')
  })

  it('profiles の JOIN が新スキーマの id を使用する', () => {
    expect(NOTIFICATION_BASE_JOINS).toContain(
      'ap ON n.actor_profile_id = ap.id',
    )
    expect(NOTIFICATION_BASE_JOINS).not.toContain('ap.profile_id')
  })

  it('post_stats の JOIN が rp.id を使用する', () => {
    expect(NOTIFICATION_BASE_JOINS).toContain('rpps ON rp.id = rpps.post_id')
    expect(NOTIFICATION_BASE_JOINS).not.toMatch(
      /rpps ON rp\.post_id\s*=\s*rpps\.post_id/,
    )
  })

  it('poll_votes サブクエリが含まれている', () => {
    expect(NOTIFICATION_SELECT).toContain('poll_votes')
  })

  it('edited_at_ms を使用する（edited_at ではない）', () => {
    expect(NOTIFICATION_SELECT).toContain('edited_at_ms')
    expect(NOTIFICATION_SELECT).not.toMatch(/\brp\.edited_at\b/)
  })

  it('backendUrl を local_accounts.backend_url から取得する', () => {
    expect(NOTIFICATION_SELECT).toContain('la.backend_url')
    expect(NOTIFICATION_SELECT).not.toContain('sv.base_url')
  })

  it('notification_types JOIN が新スキーマの id を使用する', () => {
    expect(NOTIFICATION_BASE_JOINS).toContain(
      'nt ON n.notification_type_id = nt.id',
    )
  })

  it('media_types.name を使用する（code ではない）', () => {
    expect(NOTIFICATION_SELECT).toContain('mt.name')
    expect(NOTIFICATION_SELECT).not.toContain('mt.code')
    // media_types の PK も新スキーマ
    expect(NOTIFICATION_SELECT).toContain('mt.id')
    expect(NOTIFICATION_SELECT).not.toContain('mt.media_type_id')
  })

  it('profile_custom_emojis.custom_emoji_id を使用する（emoji_id ではない）', () => {
    expect(NOTIFICATION_SELECT).toContain('pce2.custom_emoji_id')
    expect(NOTIFICATION_SELECT).not.toMatch(/pce2\.emoji_id\b/)
  })

  it('profile_custom_emojis の JOIN が ap.id を使用する（ap.profile_id ではない）', () => {
    expect(NOTIFICATION_SELECT).toContain('pce2.profile_id = ap.id')
    expect(NOTIFICATION_SELECT).not.toContain('pce2.profile_id = ap.profile_id')
  })
})

// ─── NOTIFICATION_BASE_JOINS のテスト ───────────────────────────

describe('NOTIFICATION_BASE_JOINS', () => {
  it('servers テーブルへの JOIN が含まれていない', () => {
    expect(NOTIFICATION_BASE_JOINS).not.toMatch(/JOIN\s+servers\b/)
  })

  it('local_accounts la を JOIN する', () => {
    expect(NOTIFICATION_BASE_JOINS).toMatch(
      /LEFT\s+JOIN\s+local_accounts\s+la\s+ON\s+n\.local_account_id\s*=\s*la\.id/,
    )
  })
})

// ─── rowToStoredNotification のテスト ────────────────────────────

describe('rowToStoredNotification', () => {
  /**
   * 新スキーマのカラムレイアウト:
   *   [0] id (notification PK)
   *   [1] backendUrl (from local_accounts.backend_url)
   *   [2] created_at_ms
   *   [3] notification_type
   *   [4] local_id
   *   [5] is_read
   *   [6] actor_acct        [7] actor_username    [8] actor_display_name
   *   [9] actor_avatar      [10] actor_header     [11] actor_locked
   *   [12] actor_bot        [13] actor_url
   *   [14] rp_post_id       [15] rp_content       [16] rp_spoiler_text
   *   [17] rp_url           [18] rp_uri           [19] rp_created_at_ms
   *   [20] rp_sensitive     [21] rp_visibility     [22] rp_language
   *   [23] rp_author_acct   [24] rp_author_username [25] rp_author_display_name
   *   [26] rp_author_avatar [27] rp_author_url    [28] rp_local_id
   *   [29] rp_in_reply_to_id [30] rp_edited_at_ms
   *   [31] rp_status_emojis_json [32] rp_account_emojis_json
   *   [33] rp_poll_json
   *   [34] actor_emojis_json
   *   [35] rp_emoji_reactions_json
   *   [36] rp_media_json    [37] rp_mentions_json
   *   [38] rp_voted         [39] rp_own_votes_json
   *   [40] reaction_name    [41] reaction_url
   */
  function makeBaseRow(): (string | number | null)[] {
    const row: (string | number | null)[] = new Array(42).fill(null)
    row[0] = 1 // id
    row[1] = 'https://example.com' // backendUrl
    row[2] = 1700000000000 // created_at_ms
    row[3] = 'favourite' // notification_type
    row[4] = '12345' // local_id
    row[5] = 0 // is_read
    row[6] = 'user@example.com' // actor_acct
    row[7] = 'user' // actor_username
    row[8] = 'User Name' // actor_display_name
    row[9] = 'https://example.com/avatar.png' // actor_avatar
    row[10] = 'https://example.com/header.png' // actor_header
    row[11] = 0 // actor_locked
    row[12] = 0 // actor_bot
    row[13] = 'https://example.com/@user' // actor_url
    return row
  }

  it('backendUrl を local_accounts.backend_url から取得する', () => {
    const row = makeBaseRow()
    row[1] = 'https://mastodon.social'
    const result = rowToStoredNotification(row)
    expect(result.backendUrl).toBe('https://mastodon.social')
  })

  it('account.id が空文字列になる（profile_aliases が無いため）', () => {
    const row = makeBaseRow()
    const result = rowToStoredNotification(row)
    // profile_aliases を使わないので actor_account_id カラムが無い → 空文字列
    expect(result.account.id).toBe('')
  })

  it('stored_at フィールドが存在しない（カラムが削除されたため）', () => {
    const row = makeBaseRow()
    const result = rowToStoredNotification(row)
    // storedAt は 0 またはデフォルト値になる
    expect(result).not.toHaveProperty('stored_at')
  })

  it('基本的な通知フィールドを正しくマッピングする', () => {
    const row = makeBaseRow()
    const result = rowToStoredNotification(row)

    expect(result.notification_id).toBe(1)
    expect(result.type).toBe('favourite')
    expect(result.id).toBe('12345')
    expect(result.created_at).toBe(new Date(1700000000000).toISOString())
    expect(result.created_at_ms).toBe(1700000000000)
  })

  it('actor の情報を正しくマッピングする', () => {
    const row = makeBaseRow()
    const result = rowToStoredNotification(row)

    expect(result.account.acct).toBe('user@example.com')
    expect(result.account.username).toBe('user')
    expect(result.account.display_name).toBe('User Name')
    expect(result.account.avatar).toBe('https://example.com/avatar.png')
    expect(result.account.header).toBe('https://example.com/header.png')
    expect(result.account.locked).toBe(false)
    expect(result.account.bot).toBe(false)
    expect(result.account.url).toBe('https://example.com/@user')
  })

  it('related_post が null の場合 status は undefined', () => {
    const row = makeBaseRow()
    const result = rowToStoredNotification(row)
    expect(result.status).toBeUndefined()
  })

  it('related_post がある場合 status を正しくマッピングする', () => {
    const row = makeBaseRow()
    row[14] = 100 // rp_post_id
    row[15] = '<p>Hello</p>' // rp_content
    row[16] = '' // rp_spoiler_text
    row[17] = 'https://example.com/@user/100' // rp_url
    row[18] = 'https://example.com/activity/100' // rp_uri
    row[19] = 1700000000000 // rp_created_at_ms
    row[20] = 0 // rp_sensitive
    row[21] = 'public' // rp_visibility
    row[22] = 'en' // rp_language
    row[23] = 'author@example.com' // rp_author_acct
    row[24] = 'author' // rp_author_username
    row[25] = 'Author Name' // rp_author_display_name
    row[26] = 'https://example.com/author_avatar.png' // rp_author_avatar
    row[27] = 'https://example.com/@author' // rp_author_url
    row[28] = 'local-100' // rp_local_id
    row[29] = null // rp_in_reply_to_id
    row[30] = null // rp_edited_at_ms (INTEGER)

    const result = rowToStoredNotification(row)
    expect(result.status).toBeDefined()
    expect(result.status?.content).toBe('<p>Hello</p>')
    expect(result.status?.id).toBe('local-100')
    expect(result.status?.uri).toBe('https://example.com/activity/100')
    expect(result.status?.visibility).toBe('public')
    expect(result.status?.language).toBe('en')
    expect(result.status?.account.acct).toBe('author@example.com')
    expect(result.status?.account.username).toBe('author')
    expect(result.status?.account.display_name).toBe('Author Name')
  })

  it('edited_at_ms (INTEGER) を ISO 文字列に変換する', () => {
    const row = makeBaseRow()
    row[14] = 100 // rp_post_id
    row[19] = 1700000000000
    row[30] = 1700001000000 // rp_edited_at_ms as INTEGER

    const result = rowToStoredNotification(row)
    expect(result.status).toBeDefined()
    expect(result.status?.edited_at).toBe(new Date(1700001000000).toISOString())
  })

  it('edited_at_ms が null の場合 edited_at は null', () => {
    const row = makeBaseRow()
    row[14] = 100 // rp_post_id
    row[19] = 1700000000000
    row[30] = null

    const result = rowToStoredNotification(row)
    expect(result.status).toBeDefined()
    expect(result.status?.edited_at).toBeNull()
  })

  it('rp_author_account_id カラムが無いため status.account.id は空文字列', () => {
    const row = makeBaseRow()
    row[14] = 100 // rp_post_id
    row[19] = 1700000000000

    const result = rowToStoredNotification(row)
    expect(result.status).toBeDefined()
    expect(result.status?.account.id).toBe('')
  })

  it('reaction 情報を正しくマッピングする', () => {
    const row = makeBaseRow()
    row[40] = '⭐' // reaction_name
    row[41] = null // reaction_url

    const result = rowToStoredNotification(row)
    expect(result.reaction).toBeDefined()
    expect(result.reaction?.name).toBe('⭐')
    expect(result.reaction?.count).toBe(1)
  })

  it('reaction に URL がある場合 url/static_url を含める', () => {
    const row = makeBaseRow()
    row[40] = 'blobcat'
    row[41] = 'https://example.com/emoji/blobcat.png'

    const result = rowToStoredNotification(row)
    expect(result.reaction).toBeDefined()
    expect(result.reaction?.name).toBe('blobcat')
    expect(result.reaction?.url).toBe('https://example.com/emoji/blobcat.png')
    expect(result.reaction?.static_url).toBe(
      'https://example.com/emoji/blobcat.png',
    )
  })

  it('poll の voted/own_votes を poll_votes から取得する', () => {
    const row = makeBaseRow()
    row[14] = 100 // rp_post_id
    row[19] = 1700000000000
    row[33] = JSON.stringify({
      expires_at: null,
      id: 5,
      multiple: 0,
      options: [
        { title: 'Option A', votes_count: 6 },
        { title: 'Option B', votes_count: 4 },
      ],
      votes_count: 10,
    })
    row[38] = 1 // rp_voted
    row[39] = '[0]' // rp_own_votes_json

    const result = rowToStoredNotification(row)
    expect(result.status).toBeDefined()
    expect(result.status?.poll).toBeDefined()
    expect(result.status?.poll?.voted).toBe(true)
    expect(result.status?.poll?.own_votes).toEqual([0])
  })

  it('poll_votes が null の場合 voted=false, own_votes 無し', () => {
    const row = makeBaseRow()
    row[14] = 100 // rp_post_id
    row[19] = 1700000000000
    row[33] = JSON.stringify({
      expires_at: null,
      id: 5,
      multiple: 0,
      options: [
        { title: 'Option A', votes_count: 6 },
        { title: 'Option B', votes_count: 4 },
      ],
      votes_count: 10,
    })
    row[38] = null // rp_voted
    row[39] = null // rp_own_votes_json

    const result = rowToStoredNotification(row)
    expect(result.status).toBeDefined()
    expect(result.status?.poll).toBeDefined()
    expect(result.status?.poll?.voted).toBe(false)
  })
})
