import { describe, expect, it } from 'vitest'
import type { TableName } from '../../../protocol'
import type { WrittenTableCollector } from '../types'

// ================================================================
// テスト用モック DB
// ================================================================

/**
 * SQL を受け取り resultRows 問い合わせには定型値を返すモック DB。
 * 実際の SQLite は使わず collector パターンだけを検証する。
 */
function createMockDb(returnRows: Record<string, unknown[][]> = {}) {
  const calls: string[] = []
  return {
    calls,
    db: {
      exec: (
        sql: string,
        opts?: {
          bind?: (string | number | null)[]
          returnValue?: 'resultRows'
        },
      ): unknown => {
        calls.push(sql)
        if (opts?.returnValue === 'resultRows') {
          for (const [pattern, rows] of Object.entries(returnRows)) {
            if (sql.includes(pattern)) return rows
          }
          return []
        }
        return undefined
      },
    },
  }
}

// ================================================================
// WrittenTableCollector 基本動作
// ================================================================

describe('WrittenTableCollector', () => {
  it('should work as a Set<TableName>', () => {
    const collector: WrittenTableCollector = new Set<TableName>()
    collector.add('posts')
    collector.add('timeline_entries')
    expect(collector.has('posts')).toBe(true)
    expect(collector.has('timeline_entries')).toBe(true)
    expect(collector.size).toBe(2)
  })

  it('should support add/has/spread operations', () => {
    const collector: WrittenTableCollector = new Set<TableName>()
    collector.add('posts')
    collector.add('post_media')
    collector.add('posts') // duplicate
    const arr = [...collector] as TableName[]
    expect(arr).toHaveLength(2)
    expect(arr).toContain('posts')
    expect(arr).toContain('post_media')
  })
})

// ================================================================
// syncPostHashtags
// ================================================================

describe('syncPostHashtags collector', () => {
  // Dynamic import to avoid issues if module not yet updated
  const importHashtag = () =>
    import('../../../helpers/hashtag').then((m) => m.syncPostHashtags)

  it('should report hashtags and post_hashtags when tags are provided', async () => {
    const syncPostHashtags = await importHashtag()
    const collector: WrittenTableCollector = new Set()
    const { db } = createMockDb({
      'SELECT id FROM hashtags': [[1]],
    })
    syncPostHashtags(
      db,
      1,
      [{ name: 'test', url: 'https://example.com' }],
      collector,
    )
    expect(collector.has('hashtags')).toBe(true)
    expect(collector.has('post_hashtags')).toBe(true)
  })

  it('should report only post_hashtags when tags array is empty (delete only)', async () => {
    const syncPostHashtags = await importHashtag()
    const collector: WrittenTableCollector = new Set()
    const { db } = createMockDb()
    syncPostHashtags(db, 1, [], collector)
    expect(collector.has('post_hashtags')).toBe(true)
    expect(collector.has('hashtags')).toBe(false)
  })

  it('should not break when collector is undefined (backward compat)', async () => {
    const syncPostHashtags = await importHashtag()
    const { db } = createMockDb({
      'SELECT id FROM hashtags': [[1]],
    })
    // Should not throw
    expect(() => syncPostHashtags(db, 1, [{ name: 'test' }])).not.toThrow()
    expect(() => syncPostHashtags(db, 1, [])).not.toThrow()
  })
})

// ================================================================
// syncPostMedia
// ================================================================

describe('syncPostMedia collector', () => {
  const importPostSync = () =>
    import('../postSync').then((m) => m.syncPostMedia)

  it('should report post_media when called', async () => {
    const syncPostMedia = await importPostSync()
    const collector: WrittenTableCollector = new Set()
    const { db } = createMockDb({
      'SELECT id FROM media_types': [[1]],
    })
    syncPostMedia(db, 1, [], collector)
    expect(collector.has('post_media')).toBe(true)
  })

  it('should not break when collector is undefined (backward compat)', async () => {
    const syncPostMedia = await importPostSync()
    const { db } = createMockDb({
      'SELECT id FROM media_types': [[1]],
    })
    expect(() => syncPostMedia(db, 1, [])).not.toThrow()
  })
})

// ================================================================
// syncPostStats
// ================================================================

describe('syncPostStats collector', () => {
  const importPostSync = () =>
    import('../postSync').then((m) => m.syncPostStats)

  it('should report post_stats when called', async () => {
    const syncPostStats = await importPostSync()
    const collector: WrittenTableCollector = new Set()
    const { db } = createMockDb()
    const mockStatus = {
      emoji_reactions: [],
      favourites_count: 0,
      reblogs_count: 0,
      replies_count: 0,
    } as Parameters<typeof syncPostStats>[2]
    syncPostStats(db, 1, mockStatus, collector)
    expect(collector.has('post_stats')).toBe(true)
  })

  it('should not break when collector is undefined (backward compat)', async () => {
    const syncPostStats = await importPostSync()
    const { db } = createMockDb()
    const mockStatus = {
      emoji_reactions: [],
      favourites_count: 0,
      reblogs_count: 0,
      replies_count: 0,
    } as Parameters<typeof syncPostStats>[2]
    expect(() => syncPostStats(db, 1, mockStatus)).not.toThrow()
  })
})

// ================================================================
// upsertMentionsInternal
// ================================================================

describe('upsertMentionsInternal collector', () => {
  const importPostSync = () =>
    import('../postSync').then((m) => m.upsertMentionsInternal)

  it('should report post_mentions when called', async () => {
    const upsertMentionsInternal = await importPostSync()
    const collector: WrittenTableCollector = new Set()
    const { db } = createMockDb()
    upsertMentionsInternal(db, 1, [], collector)
    expect(collector.has('post_mentions')).toBe(true)
  })

  it('should not break when collector is undefined (backward compat)', async () => {
    const upsertMentionsInternal = await importPostSync()
    const { db } = createMockDb()
    expect(() => upsertMentionsInternal(db, 1, [])).not.toThrow()
  })
})

// ================================================================
// syncPostCustomEmojis
// ================================================================

describe('syncPostCustomEmojis collector', () => {
  const importEmoji = () =>
    import('../../../helpers/emoji').then((m) => m.syncPostCustomEmojis)

  it('should report post_custom_emojis when called', async () => {
    const syncPostCustomEmojis = await importEmoji()
    const collector: WrittenTableCollector = new Set()
    const { db } = createMockDb()
    syncPostCustomEmojis(db, 1, 1, [], collector)
    expect(collector.has('post_custom_emojis')).toBe(true)
  })

  it('should not break when collector is undefined (backward compat)', async () => {
    const syncPostCustomEmojis = await importEmoji()
    const { db } = createMockDb()
    expect(() => syncPostCustomEmojis(db, 1, 1, [])).not.toThrow()
  })
})

// ================================================================
// syncProfileCustomEmojis
// ================================================================

describe('syncProfileCustomEmojis collector', () => {
  const importProfile = () =>
    import('../../../helpers/profile').then((m) => m.syncProfileCustomEmojis)

  it('should report profile_custom_emojis when called', async () => {
    const syncProfileCustomEmojis = await importProfile()
    const collector: WrittenTableCollector = new Set()
    const { db } = createMockDb()
    syncProfileCustomEmojis(db, 1, 1, [], collector)
    expect(collector.has('profile_custom_emojis')).toBe(true)
  })

  it('should not break when collector is undefined (backward compat)', async () => {
    const syncProfileCustomEmojis = await importProfile()
    const { db } = createMockDb()
    expect(() => syncProfileCustomEmojis(db, 1, 1, [])).not.toThrow()
  })
})

// ================================================================
// syncPollData
// ================================================================

describe('syncPollData collector', () => {
  const importPoll = () =>
    import('../../../helpers/poll').then((m) => m.syncPollData)

  it('should report polls and poll_options when poll data provided', async () => {
    const syncPollData = await importPoll()
    const collector: WrittenTableCollector = new Set()
    const { db } = createMockDb({
      'SELECT id FROM polls': [[42]],
    })
    syncPollData(
      db,
      1,
      { id: 'p1', options: [{ title: 'A', votes_count: 1 }] },
      collector,
    )
    expect(collector.has('polls')).toBe(true)
    expect(collector.has('poll_options')).toBe(true)
  })

  it('should not report anything when poll is null', async () => {
    const syncPollData = await importPoll()
    const collector: WrittenTableCollector = new Set()
    const { db } = createMockDb()
    syncPollData(db, 1, null, collector)
    expect(collector.size).toBe(0)
  })

  it('should not break when collector is undefined (backward compat)', async () => {
    const syncPollData = await importPoll()
    const { db } = createMockDb({
      'SELECT id FROM polls': [[42]],
    })
    expect(() =>
      syncPollData(db, 1, { id: 'p1', options: [{ title: 'A' }] }),
    ).not.toThrow()
  })
})

// ================================================================
// syncLinkCard
// ================================================================

describe('syncLinkCard collector', () => {
  const importCard = () =>
    import('../../../helpers/card').then((m) => m.syncLinkCard)

  it('should report cards when called', async () => {
    const syncLinkCard = await importCard()
    const collector: WrittenTableCollector = new Set()
    const { db } = createMockDb()
    syncLinkCard(db, 1, { url: 'https://example.com' }, collector)
    expect(collector.has('cards')).toBe(true)
  })

  it('should report cards when card is null (delete path)', async () => {
    const syncLinkCard = await importCard()
    const collector: WrittenTableCollector = new Set()
    const { db } = createMockDb()
    syncLinkCard(db, 1, null, collector)
    expect(collector.has('cards')).toBe(true)
  })

  it('should not break when collector is undefined (backward compat)', async () => {
    const syncLinkCard = await importCard()
    const { db } = createMockDb()
    expect(() =>
      syncLinkCard(db, 1, { url: 'https://example.com' }),
    ).not.toThrow()
  })
})

// ================================================================
// updateInteraction
// ================================================================

describe('updateInteraction collector', () => {
  const importInteraction = () =>
    import('../../../helpers/interaction').then((m) => m.updateInteraction)

  it('should report post_interactions when called', async () => {
    const updateInteraction = await importInteraction()
    const collector: WrittenTableCollector = new Set()
    const { db } = createMockDb()
    updateInteraction(db, 1, 1, 'favourite', true, collector)
    expect(collector.has('post_interactions')).toBe(true)
  })

  it('should not report anything when action is invalid', async () => {
    const updateInteraction = await importInteraction()
    const collector: WrittenTableCollector = new Set()
    const { db } = createMockDb()
    updateInteraction(db, 1, 1, 'invalid_action', true, collector)
    expect(collector.size).toBe(0)
  })

  it('should not break when collector is undefined (backward compat)', async () => {
    const updateInteraction = await importInteraction()
    const { db } = createMockDb()
    expect(() => updateInteraction(db, 1, 1, 'favourite', true)).not.toThrow()
  })
})

// ================================================================
// ensureServer
// ================================================================

describe('ensureServer collector', () => {
  const importServer = () =>
    import('../../../helpers/server').then((m) => m.ensureServer)

  it('should report servers when called', async () => {
    const ensureServer = await importServer()
    const collector: WrittenTableCollector = new Set()
    const { db } = createMockDb({
      'SELECT id FROM servers': [[1]],
    })
    ensureServer(db, 'example.com', collector)
    expect(collector.has('servers')).toBe(true)
  })

  it('should not break when collector is undefined (backward compat)', async () => {
    const ensureServer = await importServer()
    const { db } = createMockDb({
      'SELECT id FROM servers': [[1]],
    })
    expect(() => ensureServer(db, 'example.com')).not.toThrow()
  })
})

// ================================================================
// ensureProfile
// ================================================================

describe('ensureProfile collector', () => {
  const importProfile = () =>
    import('../../../helpers/profile').then((m) => m.ensureProfile)

  it('should report profiles when called', async () => {
    const ensureProfile = await importProfile()
    const collector: WrittenTableCollector = new Set()
    const { db } = createMockDb({
      'SELECT host FROM servers': [['example.com']],
      'SELECT id FROM profiles': [[1]],
    })
    const mockAccount = {
      acct: 'user@example.com',
      avatar: '',
      avatar_static: '',
      bot: false,
      display_name: 'User',
      header: '',
      header_static: '',
      locked: false,
      note: '',
      url: 'https://example.com/@user',
      username: 'user',
    } as Parameters<typeof ensureProfile>[1]
    ensureProfile(db, mockAccount, 1, collector)
    expect(collector.has('profiles')).toBe(true)
  })

  it('should not break when collector is undefined (backward compat)', async () => {
    const ensureProfile = await importProfile()
    const { db } = createMockDb({
      'SELECT host FROM servers': [['example.com']],
      'SELECT id FROM profiles': [[1]],
    })
    const mockAccount = {
      acct: 'user@example.com',
      avatar: '',
      avatar_static: '',
      bot: false,
      display_name: 'User',
      header: '',
      header_static: '',
      locked: false,
      note: '',
      url: 'https://example.com/@user',
      username: 'user',
    } as Parameters<typeof ensureProfile>[1]
    expect(() => ensureProfile(db, mockAccount, 1)).not.toThrow()
  })
})

// ================================================================
// handleBulkUpsertStatuses
// ================================================================

describe('handleBulkUpsertStatuses changedTables', () => {
  it('should return empty changedTables for empty input', async () => {
    const { handleBulkUpsertStatuses } = await import('../statusHandlers')
    const { db } = createMockDb()
    const result = handleBulkUpsertStatuses(
      db,
      [],
      'https://example.com',
      'home',
    )
    expect(result.changedTables).toEqual([])
  })
})

// ================================================================
// handleUpdateStatus
// ================================================================

describe('handleUpdateStatus changedTables', () => {
  it('should return empty changedTables when post not found', async () => {
    const { handleUpdateStatus } = await import('../statusUpdateHandler')
    const { db } = createMockDb()
    const status = JSON.stringify({
      account: { acct: 'u', emojis: [], username: 'u' },
      id: '999',
      uri: 'https://example.com/posts/999',
    })
    const result = handleUpdateStatus(db, status, 'https://example.com')
    expect(result.changedTables).toEqual([])
  })
})
