import type { Entity } from 'megalodon'
import { extractPostColumns } from 'util/db/sqlite/helpers/post'
import { describe, expect, it } from 'vitest'

/**
 * テスト用の最小限 Entity.Status モックを生成する。
 * 必須フィールドのみデフォルト値を持ち、オプションで上書き可能。
 */
function createMockStatus(
  overrides: Partial<Entity.Status> = {},
): Entity.Status {
  return {
    account: {
      acct: 'alice',
      avatar: '',
      avatar_static: '',
      bot: false,
      created_at: '2024-01-01T00:00:00.000Z',
      display_name: 'Alice',
      emojis: [],
      fields: [],
      followers_count: 0,
      following_count: 0,
      header: '',
      header_static: '',
      id: '1',
      locked: false,
      note: '',
      statuses_count: 0,
      url: 'https://example.com/@alice',
      username: 'alice',
    } as Entity.Account,
    bookmarked: false,
    content: '<p>Hello, world!</p>',
    created_at: '2024-06-15T12:30:00.000Z',
    emojis: [],
    favourited: false,
    favourites_count: 0,
    id: '12345',
    media_attachments: [],
    mentions: [],
    muted: false,
    pinned: false,
    reblog: null,
    reblogged: false,
    reblogs_count: 0,
    replies_count: 0,
    sensitive: false,
    spoiler_text: '',
    tags: [],
    uri: 'https://example.com/users/alice/statuses/12345',
    url: 'https://example.com/@alice/12345',
    visibility: 'public' as const,
    ...overrides,
  } as Entity.Status
}

describe('extractPostColumns', () => {
  it('Entity.Status からカラム値を抽出する', () => {
    const status = createMockStatus()
    const cols = extractPostColumns(status)

    expect(cols).toBeDefined()
    expect(typeof cols.object_uri).toBe('string')
    expect(typeof cols.content_html).toBe('string')
    expect(typeof cols.created_at_ms).toBe('number')
    expect(typeof cols.is_sensitive).toBe('number')
    expect(typeof cols.visibility_id).toBe('number')
  })

  it('必須フィールドが正しく変換される（content → content_html, created_at → created_at_ms）', () => {
    const status = createMockStatus({
      content: '<p>テスト投稿です</p>',
      created_at: '2024-06-15T12:30:00.000Z',
      uri: 'https://example.com/users/alice/statuses/99',
    })

    const cols = extractPostColumns(status)

    expect(cols.object_uri).toBe('https://example.com/users/alice/statuses/99')
    expect(cols.content_html).toBe('<p>テスト投稿です</p>')
    expect(cols.created_at_ms).toBe(
      new Date('2024-06-15T12:30:00.000Z').getTime(),
    )
  })

  it('オプショナルフィールドが null/undefined の場合デフォルト値を返す', () => {
    const status = createMockStatus({
      application: undefined,
      edited_at: undefined,
      in_reply_to_account_id: undefined,
      in_reply_to_id: undefined,
      language: undefined,
      plain_content: undefined,
    })

    const cols = extractPostColumns(status)

    expect(cols.edited_at_ms).toBeNull()
    expect(cols.plain_content).toBeNull()
    expect(cols.language).toBeNull()
    expect(cols.in_reply_to_uri).toBeNull()
    expect(cols.in_reply_to_account_acct).toBeNull()
    expect(cols.application_name).toBeNull()
  })

  it('spoiler_text が空文字列の場合そのまま返す', () => {
    const status = createMockStatus({ spoiler_text: '' })
    const cols = extractPostColumns(status)
    expect(cols.spoiler_text).toBe('')
  })

  it('spoiler_text に値がある場合そのまま返す', () => {
    const status = createMockStatus({ spoiler_text: 'ネタバレ注意' })
    const cols = extractPostColumns(status)
    expect(cols.spoiler_text).toBe('ネタバレ注意')
  })

  it('edited_at が存在する場合 ms に変換する', () => {
    const editedAt = '2024-06-16T08:00:00.000Z'
    const status = createMockStatus({ edited_at: editedAt })
    const cols = extractPostColumns(status)
    expect(cols.edited_at_ms).toBe(new Date(editedAt).getTime())
  })

  it('edited_at が null の場合 null を返す', () => {
    const status = createMockStatus({ edited_at: null })
    const cols = extractPostColumns(status)
    expect(cols.edited_at_ms).toBeNull()
  })

  it('language が存在する場合そのまま返す', () => {
    const status = createMockStatus({ language: 'ja' })
    const cols = extractPostColumns(status)
    expect(cols.language).toBe('ja')
  })

  it('language が null の場合 null を返す', () => {
    const status = createMockStatus({ language: null })
    const cols = extractPostColumns(status)
    expect(cols.language).toBeNull()
  })

  describe('visibility を visibility_id に変換する', () => {
    it('public を 1 に変換する', () => {
      const status = createMockStatus({ visibility: 'public' })
      const cols = extractPostColumns(status)
      expect(cols.visibility_id).toBe(1)
    })

    it('unlisted を 2 に変換する', () => {
      const status = createMockStatus({ visibility: 'unlisted' })
      const cols = extractPostColumns(status)
      expect(cols.visibility_id).toBe(2)
    })

    it('private を 3 に変換する', () => {
      const status = createMockStatus({ visibility: 'private' })
      const cols = extractPostColumns(status)
      expect(cols.visibility_id).toBe(3)
    })

    it('direct を 4 に変換する', () => {
      const status = createMockStatus({ visibility: 'direct' })
      const cols = extractPostColumns(status)
      expect(cols.visibility_id).toBe(4)
    })
  })

  it('application_name を抽出する', () => {
    const status = createMockStatus({
      application: { name: 'Tusky', website: 'https://tusky.app' },
    })
    const cols = extractPostColumns(status)
    expect(cols.application_name).toBe('Tusky')
  })

  it('application が null の場合 application_name は null を返す', () => {
    const status = createMockStatus({ application: null })
    const cols = extractPostColumns(status)
    expect(cols.application_name).toBeNull()
  })

  it('quote 関連フィールドを抽出する', () => {
    const statusWithQuote = createMockStatus({
      quote: createMockStatus({
        uri: 'https://example.com/users/bob/statuses/999',
      }),
    } as Partial<Entity.Status>)

    const cols = extractPostColumns(statusWithQuote)
    // quote が存在すれば quote_state に値が入る
    expect(cols.quote_state).not.toBeNull()
  })

  it('quote が存在しない場合 quote_state は null を返す', () => {
    const status = createMockStatus()
    const cols = extractPostColumns(status)
    expect(cols.quote_state).toBeNull()
  })

  it('in_reply_to_uri と in_reply_to_account_acct を抽出する', () => {
    const status = createMockStatus({
      in_reply_to_account_id: '42',
      in_reply_to_id: '67890',
      mentions: [
        {
          acct: 'bob@remote.example',
          id: '42',
          url: 'https://remote.example/@bob',
          username: 'bob',
        },
      ],
    })

    const cols = extractPostColumns(status)
    // in_reply_to_id をそのまま in_reply_to_uri として渡す
    expect(cols.in_reply_to_uri).toBe('67890')
    // mentions から in_reply_to_account_id に一致するアカウントの acct を解決する
    expect(cols.in_reply_to_account_acct).toBe('bob@remote.example')
  })

  it('in_reply_to_account_id に一致する mention がない場合 acct は null を返す', () => {
    const status = createMockStatus({
      in_reply_to_account_id: '999',
      in_reply_to_id: '67890',
      mentions: [
        {
          acct: 'bob@remote.example',
          id: '42',
          url: 'https://remote.example/@bob',
          username: 'bob',
        },
      ],
    })

    const cols = extractPostColumns(status)
    expect(cols.in_reply_to_uri).toBe('67890')
    expect(cols.in_reply_to_account_acct).toBeNull()
  })

  it('sensitive が true の場合 is_sensitive は 1 を返す', () => {
    const status = createMockStatus({ sensitive: true })
    const cols = extractPostColumns(status)
    expect(cols.is_sensitive).toBe(1)
  })

  it('sensitive が false の場合 is_sensitive は 0 を返す', () => {
    const status = createMockStatus({ sensitive: false })
    const cols = extractPostColumns(status)
    expect(cols.is_sensitive).toBe(0)
  })

  it('canonical_url が存在する場合そのまま返す', () => {
    const status = createMockStatus({
      url: 'https://example.com/@alice/12345',
    })
    const cols = extractPostColumns(status)
    expect(cols.canonical_url).toBe('https://example.com/@alice/12345')
  })

  it('is_local_only はデフォルトで 0 を返す', () => {
    const status = createMockStatus()
    const cols = extractPostColumns(status)
    expect(cols.is_local_only).toBe(0)
  })

  it('plain_content が存在する場合そのまま返す', () => {
    const status = createMockStatus({
      plain_content: 'Hello, world!',
    } as Partial<Entity.Status>)
    const cols = extractPostColumns(status)
    expect(cols.plain_content).toBe('Hello, world!')
  })
})
