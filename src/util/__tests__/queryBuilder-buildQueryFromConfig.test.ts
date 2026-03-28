import type { TimelineConfigV2 } from 'types/types'
import { buildQueryFromConfig } from 'util/queryBuilder'
import { describe, expect, it } from 'vitest'

// ─── helpers ────────────────────────────────────────────────────

/** テスト用の最小限 TimelineConfigV2 を生成する */
function makeConfig(
  overrides: Partial<TimelineConfigV2> = {},
): TimelineConfigV2 {
  return {
    applyInstanceBlock: false,
    applyMuteFilter: false,
    id: 'test',
    order: 0,
    type: 'home',
    visible: true,
    ...overrides,
  }
}

// ─── メディアフィルタ ──────────────────────────────────────────

describe('buildQueryFromConfig: メディアフィルタ', () => {
  it('onlyMedia が EXISTS(SELECT 1 FROM post_media ...) を生成すること', () => {
    const query = buildQueryFromConfig(makeConfig({ onlyMedia: true }))
    expect(query).toContain('EXISTS')
    expect(query).toContain('post_media')
    expect(query).not.toContain('has_media')
  })

  it('minMediaCount が (SELECT COUNT(*) FROM post_media ...) >= N を生成すること', () => {
    const query = buildQueryFromConfig(makeConfig({ minMediaCount: 3 }))
    expect(query).toContain('COUNT')
    expect(query).toContain('post_media')
    expect(query).toContain('>= 3')
    expect(query).not.toContain('media_count')
  })

  it('minMediaCount が 1 の場合は EXISTS を生成すること', () => {
    const query = buildQueryFromConfig(makeConfig({ minMediaCount: 1 }))
    expect(query).toContain('EXISTS')
    expect(query).toContain('post_media')
  })
})

// ─── 公開範囲フィルタ ──────────────────────────────────────────

describe('buildQueryFromConfig: 公開範囲フィルタ', () => {
  it('visibilityFilter が vt.name IN (...) を生成すること', () => {
    const query = buildQueryFromConfig(
      makeConfig({ visibilityFilter: ['public', 'unlisted'] }),
    )
    expect(query).toContain('vt.name')
    expect(query).toContain("'public'")
    expect(query).toContain("'unlisted'")
    expect(query).not.toContain('p.visibility')
  })

  it('全公開範囲を指定した場合はフィルタなし', () => {
    const query = buildQueryFromConfig(
      makeConfig({
        visibilityFilter: ['public', 'unlisted', 'private', 'direct'],
      }),
    )
    expect(query).not.toContain('visibility')
  })
})

// ─── 言語フィルタ ──────────────────────────────────────────────

describe('buildQueryFromConfig: 言語フィルタ', () => {
  it('languageFilter が p.language IN (...) を生成すること', () => {
    const query = buildQueryFromConfig(
      makeConfig({ languageFilter: ['ja', 'en'] }),
    )
    expect(query).toContain("p.language IN ('ja','en')")
  })
})

// ─── ブースト除外 ──────────────────────────────────────────────

describe('buildQueryFromConfig: ブースト除外', () => {
  it('excludeReblogs が p.is_reblog = 0 を生成すること', () => {
    const query = buildQueryFromConfig(makeConfig({ excludeReblogs: true }))
    expect(query).toContain('p.is_reblog = 0')
  })
})

// ─── リプライ除外 ──────────────────────────────────────────────

describe('buildQueryFromConfig: リプライ除外', () => {
  it('excludeReplies が p.in_reply_to_uri IS NULL を生成すること（p.in_reply_to_id ではない）', () => {
    const query = buildQueryFromConfig(makeConfig({ excludeReplies: true }))
    expect(query).toContain('p.in_reply_to_uri IS NULL')
    expect(query).not.toContain('p.in_reply_to_id')
  })
})

// ─── CW除外 ────────────────────────────────────────────────────

describe('buildQueryFromConfig: CW除外', () => {
  it("excludeSpoiler が p.spoiler_text = '' を生成すること（p.has_spoiler ではない）", () => {
    const query = buildQueryFromConfig(makeConfig({ excludeSpoiler: true }))
    expect(query).toContain("p.spoiler_text = ''")
    expect(query).not.toContain('has_spoiler')
  })
})

// ─── センシティブ除外 ──────────────────────────────────────────

describe('buildQueryFromConfig: センシティブ除外', () => {
  it('excludeSensitive が p.is_sensitive = 0 を生成すること', () => {
    const query = buildQueryFromConfig(makeConfig({ excludeSensitive: true }))
    expect(query).toContain('p.is_sensitive = 0')
  })
})

// ─── アカウントフィルタ ────────────────────────────────────────

describe('buildQueryFromConfig: アカウントフィルタ', () => {
  it('include モードが pr.acct IN (...) を生成すること（p.account_acct ではない）', () => {
    const query = buildQueryFromConfig(
      makeConfig({
        accountFilter: { accts: ['user@example.com'], mode: 'include' },
      }),
    )
    expect(query).toContain('pr.acct')
    expect(query).toContain("IN ('user@example.com')")
    expect(query).not.toContain('p.account_acct')
  })

  it('exclude モードが pr.acct NOT IN (...) を生成すること', () => {
    const query = buildQueryFromConfig(
      makeConfig({
        accountFilter: { accts: ['spam@example.com'], mode: 'exclude' },
      }),
    )
    expect(query).toContain('pr.acct')
    expect(query).toContain("NOT IN ('spam@example.com')")
    expect(query).not.toContain('p.account_acct')
  })
})

// ─── 通知タイプ ────────────────────────────────────────────────

describe('buildQueryFromConfig: 通知タイプフィルタ', () => {
  it("単一タイプが nt.name = 'X' を生成すること（n.notification_type ではない）", () => {
    const query = buildQueryFromConfig(
      makeConfig({ notificationFilter: ['follow'], type: 'notification' }),
    )
    expect(query).toContain("nt.name = 'follow'")
    expect(query).not.toContain('n.notification_type')
  })

  it('複数タイプが nt.name IN (...) を生成すること', () => {
    const query = buildQueryFromConfig(
      makeConfig({
        notificationFilter: ['follow', 'favourite'],
        type: 'notification',
      }),
    )
    expect(query).toContain('nt.name IN')
    expect(query).not.toContain('n.notification_type')
  })

  it('全タイプが nt.name IS NOT NULL を生成すること', () => {
    const query = buildQueryFromConfig(
      makeConfig({
        notificationFilter: [
          'follow',
          'follow_request',
          'mention',
          'reblog',
          'favourite',
          'reaction',
          'poll_expired',
          'status',
        ],
        type: 'notification',
      }),
    )
    expect(query).toContain('nt.name IS NOT NULL')
    expect(query).not.toContain('n.notification_type')
  })
})

// ─── バックエンドフィルタ ──────────────────────────────────────

describe('buildQueryFromConfig: バックエンドフィルタ', () => {
  it('status のみの場合、サブクエリ形式を生成すること（pb.backendUrl ではない）', () => {
    const query = buildQueryFromConfig(
      makeConfig({
        backendFilter: {
          backendUrl: 'https://mastodon.social',
          mode: 'single',
        },
      }),
    )
    // post_backend_ids + local_accounts サブクエリ
    expect(query).toContain('post_backend_ids')
    expect(query).toContain('local_accounts')
    expect(query).toContain("backend_url = 'https://mastodon.social'")
    expect(query).not.toContain('pb.backendUrl')
  })

  it("notification のみの場合、la.backend_url = 'X' を生成すること", () => {
    const query = buildQueryFromConfig(
      makeConfig({
        backendFilter: {
          backendUrl: 'https://mastodon.social',
          mode: 'single',
        },
        notificationFilter: ['follow'],
        type: 'notification',
      }),
    )
    expect(query).toContain("la.backend_url = 'https://mastodon.social'")
    expect(query).not.toContain('n.backend_url')
  })
})

// ─── タグ条件 ──────────────────────────────────────────────────

describe('buildQueryFromConfig: タグ条件', () => {
  it("単一タグが ht.name = 'X' を生成すること", () => {
    const query = buildQueryFromConfig(
      makeConfig({
        tagConfig: { mode: 'or', tags: ['photo'] },
        type: 'tag',
      }),
    )
    expect(query).toContain("ht.name = 'photo'")
  })

  it('AND モードで p.id IN (サブクエリ) を生成すること（p.post_id ではない）', () => {
    const query = buildQueryFromConfig(
      makeConfig({
        tagConfig: { mode: 'and', tags: ['photo', 'art'] },
        type: 'tag',
      }),
    )
    expect(query).toContain('p.id IN')
    expect(query).not.toContain('p.post_id')
    // サブクエリ内の JOIN が ht_inner.id を使っていること（旧 ht_inner.hashtag_id ではない）
    expect(query).toContain('ht_inner.id')
  })

  it('AND モードのサブクエリが正しい JOIN を含むこと', () => {
    const query = buildQueryFromConfig(
      makeConfig({
        tagConfig: { mode: 'and', tags: ['photo', 'art'] },
        type: 'tag',
      }),
    )
    expect(query).toContain('pht_inner.post_id')
    expect(query).toContain('hashtags ht_inner')
    expect(query).toContain('pht_inner.hashtag_id = ht_inner.id')
  })
})

// ─── 混合クエリ ────────────────────────────────────────────────

describe('buildQueryFromConfig: 混合クエリ', () => {
  it('nullTolerant が statuses 固有条件に適用されること', () => {
    const query = buildQueryFromConfig(
      makeConfig({
        excludeReblogs: true,
        notificationFilter: ['follow'],
        timelineTypes: ['home'],
      }),
    )
    // statuses 固有の条件に OR p.id IS NULL が付与される
    expect(query).toContain('p.is_reblog = 0')
    expect(query).toContain('OR p.id IS NULL')
  })

  it('言語フィルタは IS NULL を含むため nullTolerant 不要', () => {
    const query = buildQueryFromConfig(
      makeConfig({
        languageFilter: ['ja'],
        notificationFilter: ['follow'],
        timelineTypes: ['home'],
      }),
    )
    // 言語フィルタは既に OR p.language IS NULL を含むのでそのまま
    expect(query).toContain('p.language')
    expect(query).toContain('OR p.language IS NULL')
  })
})

// ─── タイムライン条件 ──────────────────────────────────────────

describe('buildQueryFromConfig: タイムライン条件', () => {
  it("home タイプが ptt.timelineType = 'home' を生成すること", () => {
    const query = buildQueryFromConfig(makeConfig({ type: 'home' }))
    expect(query).toContain("ptt.timelineType = 'home'")
  })

  it('複数 timelineTypes が ptt.timelineType IN (...) を生成すること', () => {
    const query = buildQueryFromConfig(
      makeConfig({ timelineTypes: ['home', 'local'] }),
    )
    expect(query).toContain("ptt.timelineType IN ('home','local')")
  })
})
