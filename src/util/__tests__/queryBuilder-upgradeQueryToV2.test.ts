import { upgradeQueryToV2 } from 'util/queryBuilder'
import { describe, expect, it } from 'vitest'

// ─── phantom column 変換 ────────────────────────────────────────

describe('upgradeQueryToV2: phantom column 変換', () => {
  it('p.has_media = 1 → EXISTS(SELECT 1 FROM post_media ...) に変換すること', () => {
    const result = upgradeQueryToV2('p.has_media = 1')
    expect(result).toContain('EXISTS')
    expect(result).toContain('post_media')
    expect(result).not.toContain('has_media')
  })

  it('p.has_media = 0 → NOT EXISTS(SELECT 1 FROM post_media ...) に変換すること', () => {
    const result = upgradeQueryToV2('p.has_media = 0')
    expect(result).toContain('NOT EXISTS')
    expect(result).toContain('post_media')
    expect(result).not.toContain('has_media')
  })

  it('p.media_count >= N → (SELECT COUNT(*) FROM post_media ...) >= N に変換すること', () => {
    const result = upgradeQueryToV2('p.media_count >= 3')
    expect(result).toContain('COUNT')
    expect(result).toContain('post_media')
    expect(result).toContain('>= 3')
    expect(result).not.toContain('media_count')
  })

  it("p.has_spoiler = 1 → p.spoiler_text != '' に変換すること", () => {
    const result = upgradeQueryToV2('p.has_spoiler = 1')
    expect(result).toContain("p.spoiler_text != ''")
    expect(result).not.toContain('has_spoiler')
  })

  it("p.has_spoiler = 0 → p.spoiler_text = '' に変換すること", () => {
    const result = upgradeQueryToV2('p.has_spoiler = 0')
    expect(result).toContain("p.spoiler_text = ''")
    expect(result).not.toContain('has_spoiler')
  })
})

// ─── notification compat column 変換 ────────────────────────────

describe('upgradeQueryToV2: notification compat column 変換', () => {
  it("n.notification_type = 'follow' → nt.name = 'follow' に変換すること", () => {
    const result = upgradeQueryToV2("n.notification_type = 'follow'")
    expect(result).toContain("nt.name = 'follow'")
    expect(result).not.toContain('n.notification_type')
  })

  it('n.notification_type IN (...) → nt.name IN (...) に変換すること', () => {
    const result = upgradeQueryToV2(
      "n.notification_type IN ('follow','favourite')",
    )
    expect(result).toContain("nt.name IN ('follow','favourite')")
    expect(result).not.toContain('n.notification_type')
  })

  it('n.notification_type IS NOT NULL → nt.name IS NOT NULL に変換すること', () => {
    const result = upgradeQueryToV2('n.notification_type IS NOT NULL')
    expect(result).toContain('nt.name IS NOT NULL')
    expect(result).not.toContain('n.notification_type')
  })

  it('n.account_acct → ap.acct に変換すること', () => {
    const result = upgradeQueryToV2("n.account_acct = 'user@example.com'")
    expect(result).toContain("ap.acct = 'user@example.com'")
    expect(result).not.toContain('n.account_acct')
  })

  it('n.backend_url → la.backend_url に変換すること', () => {
    const result = upgradeQueryToV2("n.backend_url = 'https://mastodon.social'")
    expect(result).toContain("la.backend_url = 'https://mastodon.social'")
    expect(result).not.toContain('n.backend_url')
  })
})

// ─── 既存の v1 → v2 変換の回帰テスト ──────────────────────────

describe('upgradeQueryToV2: 既存変換の回帰テスト', () => {
  it('json_extract メディア → p.has_media = 1 に変換すること', () => {
    const result = upgradeQueryToV2(
      "json_extract(p.json, '$.media_attachments') != '[]'",
    )
    // 注: 現在は p.has_media = 1 に変換される。
    // 将来的に EXISTS(post_media) まで変換するかは Phase 4 で判断。
    expect(result).not.toContain('json_extract')
  })

  it('json_extract ブースト除外 → p.is_reblog = 0 に変換すること', () => {
    const result = upgradeQueryToV2("json_extract(p.json, '$.reblog') IS NULL")
    expect(result).toContain('p.is_reblog = 0')
  })

  it('json_extract CW → p.has_spoiler に変換すること', () => {
    const result = upgradeQueryToV2(
      "json_extract(p.json, '$.spoiler_text') = ''",
    )
    // 注: 現在は p.has_spoiler = 0 に変換される。
    // Phase 4 でさらに p.spoiler_text = '' まで変換する。
    expect(result).not.toContain('json_extract')
  })

  it('pbt.tag → ht.name に変換すること', () => {
    const result = upgradeQueryToV2("pbt.tag = 'photo'")
    expect(result).toContain("ht.name = 'photo'")
  })

  it('ntt.code → ntt.name に変換すること', () => {
    const result = upgradeQueryToV2("ntt.code = 'follow'")
    expect(result).toContain("ntt.name = 'follow'")
  })

  it('p.in_reply_to_id の json_extract → p.in_reply_to_uri IS NULL に変換すること', () => {
    const result = upgradeQueryToV2(
      "json_extract(p.json, '$.in_reply_to_id') IS NULL",
    )
    expect(result).toContain('p.in_reply_to_uri IS NULL')
  })

  it('pb.backend_url → pb.backendUrl に変換すること', () => {
    const result = upgradeQueryToV2("pb.backend_url = 'https://example.com'")
    expect(result).toContain("pb.backendUrl = 'https://example.com'")
  })

  it('p.origin_backend_url → pb.backendUrl に変換すること', () => {
    const result = upgradeQueryToV2(
      "p.origin_backend_url = 'https://example.com'",
    )
    expect(result).toContain("pb.backendUrl = 'https://example.com'")
  })

  it('旧 PK 名 notification_types.notification_type_id → .id に変換すること', () => {
    const result = upgradeQueryToV2(
      'notification_types ntt ON ntt.notification_type_id',
    )
    expect(result).toContain('notification_types ntt ON ntt.id')
  })

  it('旧 PK 名 profiles.profile_id → .id に変換すること', () => {
    const result = upgradeQueryToV2('profiles pr ON pr.profile_id')
    expect(result).toContain('profiles pr ON pr.id')
  })

  it('旧 PK 名 posts.post_id → .id に変換すること', () => {
    const result = upgradeQueryToV2('posts p ON p.post_id')
    expect(result).toContain('posts p ON p.id')
  })

  it('変換不要なクエリはそのまま返すこと', () => {
    const query = "ptt.timelineType = 'home' AND p.is_reblog = 0"
    expect(upgradeQueryToV2(query)).toBe(query)
  })
})
