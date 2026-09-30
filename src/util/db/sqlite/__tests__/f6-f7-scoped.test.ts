import type { DatabaseSync } from 'node:sqlite'
import type { Entity } from 'megalodon'
import { executeFlatFetch } from 'util/db/query-ir/executor/flatFetchExecutor'
import {
  clearAllCaches,
  ensureServer,
  resolveLocalAccountId,
  syncPostCustomEmojis,
} from 'util/db/sqlite/helpers'
import { updateInteraction } from 'util/db/sqlite/helpers/interaction'
import { syncPollVotes } from 'util/db/sqlite/helpers/poll'
import type { WrittenTableCollector } from 'util/db/sqlite/protocol'
import { handleEnsureLocalAccount } from 'util/db/sqlite/worker/handlers/accountHandlers'
import { handleUpdateStatusAction } from 'util/db/sqlite/worker/handlers/interactionHandlers'
import { handleUpsertStatus } from 'util/db/sqlite/worker/handlers/statusHandlers'
import type { DbExec } from 'util/db/sqlite/worker/handlers/types'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createRealWorkerDb } from './realWorkerCommandAdapter'

const BACKEND_A = 'https://a.test'
const BACKEND_B = 'https://b.test'

function account(id: string, acct: string): Entity.Account {
  return {
    acct,
    avatar: '',
    avatar_static: '',
    bot: false,
    created_at: '2024-01-01T00:00:00.000Z',
    display_name: acct,
    emojis: [],
    fields: [],
    followers_count: 0,
    following_count: 0,
    group: null,
    header: '',
    header_static: '',
    id,
    limited: null,
    locked: false,
    moved: null,
    noindex: null,
    note: '',
    statuses_count: 0,
    suspended: null,
    url: 'https://a.test/@x',
    username: acct.split('@')[0],
  } as Entity.Account
}

function status(
  id: string,
  overrides: Partial<Entity.Status> = {},
): Entity.Status {
  return {
    account: account('author-1', 'alice@a.test'),
    bookmarked: false,
    content: '<p>hello</p>',
    created_at: '2024-06-15T12:30:00.000Z',
    emojis: [],
    favourited: false,
    favourites_count: 0,
    id,
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
    uri: `https://a.test/users/alice/statuses/${id}`,
    url: `https://a.test/@alice/${id}`,
    visibility: 'public',
    ...overrides,
  } as Entity.Status
}

let db: DbExec
let native: DatabaseSync

beforeEach(() => {
  const real = createRealWorkerDb()
  db = real.db
  native = real.native
  handleEnsureLocalAccount(
    db,
    BACKEND_A,
    JSON.stringify(account('me-a', 'me@a.test')),
  )
  onTestFinished(() => {
    vi.useRealTimers()
    native.close()
    clearAllCaches()
  })
})

function upsert(s: Entity.Status, backendUrl = BACKEND_A, type = 'home') {
  return handleUpsertStatus(db, JSON.stringify(s), backendUrl, type)
}

describe('F6: 冪等リレーション書き込み (実 DB)', () => {
  it('同一ペイロード + 同一時刻 → 2回目は changedTables が空', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    const s = status('s1', {
      media_attachments: [
        {
          description: 'd',
          id: 'm1',
          type: 'image',
          url: 'https://a.test/m1.png',
        } as Entity.Attachment,
      ],
      mentions: [{ acct: 'bob@a.test', id: 'b1', url: '', username: 'bob' }],
      tags: [{ name: 'cat', url: 'https://a.test/tags/cat' }],
    })
    const first = upsert(s)
    expect(first.changedTables.length).toBeGreaterThan(0)

    const second = upsert(s)
    expect(second.changedTables).toEqual([])
  })

  it('時刻が進んだ同一ペイロード → 時刻所有テーブルのみ更新され、リレーションは再書き込みされない', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    const s = status('s1', {
      media_attachments: [
        {
          description: 'd',
          id: 'm1',
          type: 'image',
          url: 'https://a.test/m1.png',
        } as Entity.Attachment,
      ],
      tags: [{ name: 'cat', url: 'https://a.test/tags/cat' }],
    })
    upsert(s)

    vi.setSystemTime(1_700_000_060_000)
    const later = upsert(s)

    const relationTables = [
      'post_media',
      'post_hashtags',
      'post_mentions',
      'post_custom_emojis',
      'poll_options',
      'cards',
      'timeline_entries',
    ]
    for (const t of relationTables) {
      expect(later.changedTables).not.toContain(t)
    }
    expect(later.changedTables).toContain('posts')

    const mediaCount = native
      .prepare('SELECT COUNT(*) AS c FROM post_media')
      .get() as { c: number }
    expect(mediaCount.c).toBe(1)
  })

  it('別 timelineType への追加 → timeline_entries のみ新規報告', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    const s = status('s1')
    upsert(s, BACKEND_A, 'home')

    const res = upsert(s, BACKEND_A, 'local')
    expect(res.changedTables).toContain('timeline_entries')
    expect(res.changedTables).not.toContain('posts')
    expect(res.changedTables).not.toContain('post_media')

    const entries = native
      .prepare(
        "SELECT COUNT(*) AS c FROM timeline_entries WHERE timeline_key = 'local';",
      )
      .get() as { c: number }
    expect(entries.c).toBe(1)
  })

  it('stats 変更は post_stats を報告する', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    upsert(status('s1'))
    const res = upsert({ ...status('s1'), favourites_count: 7 })
    expect(res.changedTables).toContain('post_stats')
  })

  it('空配列へのクリアは実際に行を削除して報告する', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    upsert(
      status('s1', {
        media_attachments: [
          {
            description: 'd',
            id: 'm1',
            type: 'image',
            url: 'https://a.test/m1.png',
          } as Entity.Attachment,
        ],
      }),
    )
    const cleared = upsert(status('s1'))
    expect(cleared.changedTables).toContain('post_media')
    const rows = native
      .prepare('SELECT COUNT(*) AS c FROM post_media')
      .get() as {
      c: number
    }
    expect(rows.c).toBe(0)
  })

  it('ローカル true を直近 60 秒以内に記録した場合、サーバ由来の stale false は保護される', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    upsert(status('s1'))
    const postId = (
      native.prepare('SELECT id FROM posts;').get() as { id: number }
    ).id
    const laId = resolveLocalAccountId(db, BACKEND_A) as number | null
    expect(laId).not.toBeNull()
    const localAccountId = laId as number

    vi.setSystemTime(1_700_000_001_000)
    updateInteraction(
      db,
      postId,
      localAccountId,
      'favourite',
      true,
      undefined,
      {
        recordLocalAction: true,
      },
    )

    vi.setSystemTime(1_700_000_030_000)
    const c2: WrittenTableCollector = new Set()
    updateInteraction(db, postId, localAccountId, 'favourite', false, c2, {
      preserveRecentLocalTrueMs: 60_000,
    })
    let row = native
      .prepare(
        'SELECT is_favourited FROM post_interactions WHERE post_id = ? AND local_account_id = ?;',
      )
      .get(postId, localAccountId) as { is_favourited: number }
    expect(row.is_favourited).toBe(1)
    expect(c2.has('post_interactions')).toBe(false)

    vi.setSystemTime(1_700_000_070_000)
    updateInteraction(
      db,
      postId,
      localAccountId,
      'favourite',
      false,
      undefined,
      { preserveRecentLocalTrueMs: 60_000 },
    )
    row = native
      .prepare(
        'SELECT is_favourited FROM post_interactions WHERE post_id = ? AND local_account_id = ?;',
      )
      .get(postId, localAccountId) as { is_favourited: number }
    expect(row.is_favourited).toBe(0)
  })

  it('同一タグ名で URL のみ変更 → hashtags を報告しリンクは再書き込みしない', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    upsert(
      status('s1', { tags: [{ name: 'Cat', url: 'https://a.test/tags/cat' }] }),
    )

    const res = upsert(
      status('s1', {
        tags: [{ name: 'cat', url: 'https://a.test/tags/CAT' }],
      }),
    )
    expect(res.changedTables).toContain('hashtags')
    expect(res.changedTables).not.toContain('post_hashtags')
    const row = native
      .prepare("SELECT url FROM hashtags WHERE name = 'cat';")
      .get() as { url: string }
    expect(row.url).toBe('https://a.test/tags/CAT')
  })

  it('mention の acct/username/url が同一でも後から解決した profile_id が埋まる', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    const mentions = [
      {
        acct: 'bob@a.test',
        id: 'b1',
        url: 'https://a.test/@bob',
        username: 'bob',
      },
    ]
    upsert(status('s1', { mentions }))
    const before = native
      .prepare('SELECT profile_id FROM post_mentions WHERE acct = ?;')
      .get('bob@a.test') as { profile_id: number | null }
    expect(before.profile_id).toBeNull()

    upsert(status('by-bob', { account: account('bob-1', 'bob@a.test') }))

    const res = upsert(status('s1', { mentions }))
    expect(res.changedTables).toContain('post_mentions')
    const after = native
      .prepare('SELECT profile_id FROM post_mentions WHERE acct = ?;')
      .get('bob@a.test') as { profile_id: number | null }
    expect(after.profile_id).not.toBeNull()
  })

  it('絵文字メタデータ (url/static/picker) 変更は custom_emojis のみ報告する', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    upsert(
      status('s1', {
        emojis: [
          {
            shortcode: 'blob',
            static_url: 'https://a.test/e/blob_s.png',
            url: 'https://a.test/e/blob.png',
            visible_in_picker: true,
          } as Entity.Emoji,
        ],
      }),
    )

    const res = upsert(
      status('s1', {
        emojis: [
          {
            shortcode: 'blob',
            static_url: 'https://a.test/e/blob2_s.png',
            url: 'https://a.test/e/blob2.png',
            visible_in_picker: false,
          } as Entity.Emoji,
        ],
      }),
    )
    expect(res.changedTables).toContain('custom_emojis')
    expect(res.changedTables).not.toContain('post_custom_emojis')
    const row = native
      .prepare(
        "SELECT url, visible_in_picker FROM custom_emojis WHERE shortcode = 'blob';",
      )
      .get() as { url: string; visible_in_picker: number }
    expect(row.url).toBe('https://a.test/e/blob2.png')
    expect(row.visible_in_picker).toBe(0)
  })

  it('同一 shortcode でも server が異なれば別 custom_emoji_id でリンクが差し替わる', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    upsert(
      status('s1', {
        emojis: [
          {
            shortcode: 'blob',
            static_url: 'https://a.test/e/blob_s.png',
            url: 'https://a.test/e/blob.png',
          } as Entity.Emoji,
        ],
      }),
    )
    const postId = (
      native.prepare('SELECT id FROM posts;').get() as { id: number }
    ).id
    const serverB = ensureServer(db, 'b.test')

    const collector: WrittenTableCollector = new Set()
    syncPostCustomEmojis(
      db,
      postId,
      serverB,
      [
        {
          shortcode: 'blob',
          static_url: 'https://b.test/e/blob_s.png',
          url: 'https://b.test/e/blob.png',
        },
      ],
      collector,
    )
    expect(collector.has('custom_emojis')).toBe(true)
    expect(collector.has('post_custom_emojis')).toBe(true)

    const link = native
      .prepare(
        'SELECT custom_emoji_id FROM post_custom_emojis WHERE post_id = ?;',
      )
      .get(postId) as { custom_emoji_id: number }
    const bEmoji = native
      .prepare(
        "SELECT id FROM custom_emojis WHERE server_id = ? AND shortcode = 'blob';",
      )
      .get(serverB) as { id: number }
    expect(link.custom_emoji_id).toBe(bEmoji.id)
  })
})

describe('F7: changedPostIds (実 DB)', () => {
  it('updateStatusAction は元投稿と全リブログ wrapper を changedPostIds に含む', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    handleEnsureLocalAccount(
      db,
      BACKEND_A,
      JSON.stringify(account('me-1', 'me@a.test')),
    )
    upsert(status('orig'))
    upsert(
      status('boost1', {
        reblog: status('orig'),
      }),
    )
    const origId = (
      native
        .prepare(
          "SELECT id FROM posts WHERE object_uri = 'https://a.test/users/alice/statuses/orig';",
        )
        .get() as { id: number }
    ).id
    const boostId = (
      native
        .prepare(
          "SELECT id FROM posts WHERE object_uri = 'https://a.test/users/alice/statuses/boost1';",
        )
        .get() as { id: number }
    ).id

    const localAccountId = resolveLocalAccountId(db, BACKEND_A) as number
    const res = handleUpdateStatusAction(
      db,
      localAccountId,
      'orig',
      'favourited',
      true,
    )
    expect(res.changedTables).toContain('post_interactions')
    expect(new Set(res.changedPostIds ?? [])).toEqual(
      new Set([origId, boostId]),
    )

    const res2 = handleUpdateStatusAction(
      db,
      localAccountId,
      'boost1',
      'favourited',
      false,
    )
    expect(new Set(res2.changedPostIds ?? [])).toEqual(
      new Set([origId, boostId]),
    )
  })
})

describe('スコープ付きバッチ (実 DB, 2 アカウント)', () => {
  function seedSharedPost() {
    handleEnsureLocalAccount(
      db,
      BACKEND_A,
      JSON.stringify(account('me-a', 'me@a.test')),
    )
    handleEnsureLocalAccount(
      db,
      BACKEND_B,
      JSON.stringify(account('me-b', 'me@b.test')),
    )
    const s = status('shared', {
      poll: {
        expires_at: null,
        id: 'poll1',
        multiple: false,
        options: [
          { title: 'x', votes_count: 3 },
          { title: 'y', votes_count: 2 },
        ],
        voted: false,
        votes_count: 5,
      } as Entity.Poll,
    })
    upsert(s, BACKEND_A, 'home')
    upsert(s, BACKEND_B, 'home')

    const postId = (
      native
        .prepare(
          "SELECT id FROM posts WHERE object_uri = 'https://a.test/users/alice/statuses/shared';",
        )
        .get() as { id: number }
    ).id
    const pollId = (
      native.prepare('SELECT id FROM polls WHERE post_id = ?;').get(postId) as {
        id: number
      }
    ).id
    const laA = (
      native
        .prepare(
          "SELECT id FROM local_accounts WHERE backend_url = 'https://a.test';",
        )
        .get() as { id: number }
    ).id
    const laB = (
      native
        .prepare(
          "SELECT id FROM local_accounts WHERE backend_url = 'https://b.test';",
        )
        .get() as { id: number }
    ).id

    syncPollVotes(db, postId, laA, true, [0])
    syncPollVotes(db, postId, laB, false, [])
    updateInteraction(db, postId, laA, 'favourite', true)
    updateInteraction(db, postId, laB, 'favourite', false)
    return { laA, laB, pollId, postId }
  }

  it('backendUrls=[a] → A の投票/お気に入りのみ参照し B に漏れない', () => {
    const { postId } = seedSharedPost()
    const result = executeFlatFetch(db, {
      backendUrls: [BACKEND_A],
      displayOrder: [{ id: postId, table: 'posts' }],
      notificationIds: [],
      postIds: [postId],
    })
    const st = result.posts.get(postId)
    expect(st?.backendUrl).toBe(BACKEND_A)
    expect(st?.favourited).toBe(true)
    expect(st?.poll?.voted).toBe(true)
    expect(st?.poll?.own_votes).toEqual([0])
  })

  it('backendUrls=[b] → B の状態のみ (A の voted/favourited に漏れない)', () => {
    const { postId } = seedSharedPost()
    const result = executeFlatFetch(db, {
      backendUrls: [BACKEND_B],
      displayOrder: [{ id: postId, table: 'posts' }],
      notificationIds: [],
      postIds: [postId],
    })
    const st = result.posts.get(postId)
    expect(st?.backendUrl).toBe(BACKEND_B)
    expect(st?.favourited).toBe(false)
    expect(st?.poll?.voted).toBe(false)
    expect(st?.poll?.own_votes).toEqual([])
  })

  it('backendUrls=[a,b] → 代表は MIN server_id (a.test) と決定的', () => {
    const { postId } = seedSharedPost()
    const result = executeFlatFetch(db, {
      backendUrls: [BACKEND_A, BACKEND_B],
      displayOrder: [{ id: postId, table: 'posts' }],
      notificationIds: [],
      postIds: [postId],
    })
    const st = result.posts.get(postId)
    expect(st?.backendUrl).toBe(BACKEND_A)
    expect(st?.poll?.voted).toBe(true)
  })

  it('backendUrls=[] → 従来の非スコープテンプレート (先頭 null バインド) で実行可能', () => {
    const { postId } = seedSharedPost()
    const result = executeFlatFetch(db, {
      backendUrls: [],
      displayOrder: [{ id: postId, table: 'posts' }],
      notificationIds: [],
      postIds: [postId],
    })
    const st = result.posts.get(postId)
    expect(st).toBeDefined()
    expect(st?.poll?.id).not.toBeNull()
  })
})

describe('同一 server_id 上の 2 backendUrl スコープ (実 DB)', () => {
  const BACKEND_ALT = 'http://a.test'

  function seedSameServerPost() {
    handleEnsureLocalAccount(
      db,
      BACKEND_ALT,
      JSON.stringify(account('me-a2', 'me2@a.test')),
    )
    const uri = 'https://a.test/users/alice/statuses/sameserver'
    upsert(
      status('same-a', {
        poll: {
          expires_at: null,
          id: 'poll-same',
          multiple: false,
          options: [
            { title: 'x', votes_count: 3 },
            { title: 'y', votes_count: 2 },
          ],
          voted: false,
          votes_count: 5,
        } as Entity.Poll,
        uri,
      }),
      BACKEND_A,
      'home',
    )
    upsert(status('same-b', { uri }), BACKEND_ALT, 'home')

    const postId = (
      native.prepare('SELECT id FROM posts WHERE object_uri = ?;').get(uri) as {
        id: number
      }
    ).id
    const laA = resolveLocalAccountId(db, BACKEND_A) as number
    const laB = resolveLocalAccountId(db, BACKEND_ALT) as number
    expect(laA).not.toBe(laB)

    syncPollVotes(db, postId, laA, true, [0])
    syncPollVotes(db, postId, laB, false, [])
    updateInteraction(db, postId, laA, 'favourite', true)
    updateInteraction(db, postId, laB, 'favourite', false)
    return { laA, laB, postId }
  }

  it('backendUrls=[同サーバー別URL] → 代表 local_id/favourite/poll すべて B 側のみ', () => {
    const { postId } = seedSameServerPost()
    const result = executeFlatFetch(db, {
      backendUrls: [BACKEND_ALT],
      displayOrder: [{ id: postId, table: 'posts' }],
      notificationIds: [],
      postIds: [postId],
    })
    const st = result.posts.get(postId)
    expect(st?.backendUrl).toBe(BACKEND_ALT)
    expect(st?.id).toBe('same-b')
    expect(st?.favourited).toBe(false)
    expect(st?.poll?.voted).toBe(false)
    expect(st?.poll?.own_votes).toEqual([])
  })

  it('backendUrls=[同サーバー両方] → MIN(local_account_id) 代表で body/interactions/polls が一致', () => {
    const { postId } = seedSameServerPost()
    const result = executeFlatFetch(db, {
      backendUrls: [BACKEND_A, BACKEND_ALT],
      displayOrder: [{ id: postId, table: 'posts' }],
      notificationIds: [],
      postIds: [postId],
    })
    const st = result.posts.get(postId)
    expect(st?.backendUrl).toBe(BACKEND_A)
    expect(st?.id).toBe('same-a')
    expect(st?.favourited).toBe(true)
    expect(st?.poll?.voted).toBe(true)
    expect(st?.poll?.own_votes).toEqual([0])
  })
})
