import { parseQueryToConfig } from 'util/queryBuilder'
import { describe, expect, it } from 'vitest'

// ─── v2 ネイティブパターンの認識 ────────────────────────────────

describe('parseQueryToConfig: v2 ネイティブパターン', () => {
  it('vt.name IN (...) → visibilityFilter を認識すること', () => {
    const result = parseQueryToConfig("vt.name IN ('public','unlisted')")
    expect(result?.visibilityFilter).toEqual(['public', 'unlisted'])
  })

  it('pr.acct IN (...) → accountFilter (include) を認識すること', () => {
    const result = parseQueryToConfig("pr.acct IN ('user@example.com')")
    expect(result?.accountFilter).toEqual({
      accts: ['user@example.com'],
      mode: 'include',
    })
  })

  it('pr.acct NOT IN (...) → accountFilter (exclude) を認識すること', () => {
    const result = parseQueryToConfig("pr.acct NOT IN ('spam@example.com')")
    expect(result?.accountFilter).toEqual({
      accts: ['spam@example.com'],
      mode: 'exclude',
    })
  })

  it("nt.name = 'follow' → notificationFilter を認識すること", () => {
    const result = parseQueryToConfig("nt.name = 'follow'")
    expect(result?.notificationFilter).toEqual(['follow'])
  })

  it('nt.name IN (...) → notificationFilter を認識すること', () => {
    const result = parseQueryToConfig("nt.name IN ('follow','favourite')")
    expect(result?.notificationFilter).toEqual(['follow', 'favourite'])
  })

  it('nt.name IS NOT NULL → 全通知タイプを認識すること', () => {
    const result = parseQueryToConfig('nt.name IS NOT NULL')
    expect(result?.notificationFilter).toHaveLength(8)
  })

  it('EXISTS(SELECT 1 FROM post_media ...) → onlyMedia を認識すること', () => {
    const result = parseQueryToConfig(
      'EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)',
    )
    expect(result?.onlyMedia).toBe(true)
  })

  it('(SELECT COUNT(*) FROM post_media ...) >= N → minMediaCount を認識すること', () => {
    const result = parseQueryToConfig(
      '(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= 3',
    )
    expect(result?.minMediaCount).toBe(3)
  })

  it("p.spoiler_text = '' → excludeSpoiler を認識すること", () => {
    const result = parseQueryToConfig("p.spoiler_text = ''")
    expect(result?.excludeSpoiler).toBe(true)
  })

  it('p.in_reply_to_uri IS NULL → excludeReplies を認識すること', () => {
    const result = parseQueryToConfig('p.in_reply_to_uri IS NULL')
    expect(result?.excludeReplies).toBe(true)
  })

  it("ht.name = 'photo' → tagConfig を認識すること", () => {
    const result = parseQueryToConfig("ht.name = 'photo'")
    expect(result?.tagConfig).toEqual({ mode: 'or', tags: ['photo'] })
  })

  it("la.backend_url = 'X' → backendFilter を認識すること", () => {
    const result = parseQueryToConfig(
      "la.backend_url = 'https://mastodon.social'",
    )
    expect(result?.backendFilter).toEqual({
      backendUrl: 'https://mastodon.social',
      mode: 'single',
    })
  })
})

// ─── 旧パターンの後方互換認識 ──────────────────────────────────

describe('parseQueryToConfig: 旧パターンの後方互換', () => {
  it('p.visibility IN (...) → visibilityFilter を認識すること', () => {
    const result = parseQueryToConfig("p.visibility IN ('public','unlisted')")
    expect(result?.visibilityFilter).toEqual(['public', 'unlisted'])
  })

  it('p.account_acct IN (...) → accountFilter を認識すること', () => {
    const result = parseQueryToConfig("p.account_acct IN ('user@example.com')")
    expect(result?.accountFilter).toEqual({
      accts: ['user@example.com'],
      mode: 'include',
    })
  })

  it("n.notification_type = 'follow' → notificationFilter を認識すること", () => {
    const result = parseQueryToConfig("n.notification_type = 'follow'")
    expect(result?.notificationFilter).toEqual(['follow'])
  })

  it('p.has_media = 1 → onlyMedia を認識すること', () => {
    const result = parseQueryToConfig('p.has_media = 1')
    expect(result?.onlyMedia).toBe(true)
  })

  it('p.has_spoiler = 0 → excludeSpoiler を認識すること', () => {
    const result = parseQueryToConfig('p.has_spoiler = 0')
    expect(result?.excludeSpoiler).toBe(true)
  })

  it('p.in_reply_to_id IS NULL → excludeReplies を認識すること', () => {
    const result = parseQueryToConfig('p.in_reply_to_id IS NULL')
    expect(result?.excludeReplies).toBe(true)
  })

  it("n.backend_url = 'X' → backendFilter を認識すること", () => {
    const result = parseQueryToConfig(
      "n.backend_url = 'https://mastodon.social'",
    )
    expect(result?.backendFilter).toEqual({
      backendUrl: 'https://mastodon.social',
      mode: 'single',
    })
  })

  it('p.media_count >= N → minMediaCount を認識すること', () => {
    const result = parseQueryToConfig('p.media_count >= 3')
    expect(result?.minMediaCount).toBe(3)
  })
})

// ─── ラウンドトリップ ──────────────────────────────────────────

describe('parseQueryToConfig: ラウンドトリップ検証', () => {
  it('空クエリは null を返すこと', () => {
    expect(parseQueryToConfig('')).toBeNull()
    expect(parseQueryToConfig('   ')).toBeNull()
  })

  it('認識不能なクエリは null を返すこと', () => {
    expect(parseQueryToConfig('unknown_table.col = 1')).toBeNull()
  })
})
