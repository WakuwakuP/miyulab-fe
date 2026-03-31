import { rewriteLegacyAliases } from '../legacyAliases'

describe('rewriteLegacyAliases', () => {
  // === json_extract ベースの書き換え ===

  describe('json_extract / json_array_length の書き換え', () => {
    it("json_extract media_attachments != '[]' → EXISTS post_media", () => {
      const input = "json_extract(p.json, '$.media_attachments') != '[]'"
      expect(rewriteLegacyAliases(input)).toBe(
        'EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)',
      )
    })

    it('json_array_length media_attachments >= 2 → COUNT(*) >= 2', () => {
      const input =
        "json_array_length(json_extract(p.json, '$.media_attachments')) >= 2"
      expect(rewriteLegacyAliases(input)).toBe(
        '(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= 2',
      )
    })

    it('json_extract reblog IS NOT NULL → p.is_reblog = 1', () => {
      const input = "json_extract(p.json, '$.reblog') IS NOT NULL"
      expect(rewriteLegacyAliases(input)).toBe('p.is_reblog = 1')
    })

    it('json_extract reblog IS NULL → p.is_reblog = 0', () => {
      const input = "json_extract(p.json, '$.reblog') IS NULL"
      expect(rewriteLegacyAliases(input)).toBe('p.is_reblog = 0')
    })

    it("json_extract spoiler_text != '' → p.spoiler_text != ''", () => {
      const input = "json_extract(p.json, '$.spoiler_text') != ''"
      expect(rewriteLegacyAliases(input)).toBe("p.spoiler_text != ''")
    })

    it('json_extract sensitive = 1 → p.is_sensitive = 1', () => {
      const input = "json_extract(p.json, '$.sensitive') = 1"
      expect(rewriteLegacyAliases(input)).toBe('p.is_sensitive = 1')
    })
  })

  // === ファントムカラムの書き換え ===

  describe('ファントムカラムの書き換え', () => {
    it('p.has_media = 1 → EXISTS(SELECT 1 FROM post_media ...)', () => {
      expect(rewriteLegacyAliases('p.has_media = 1')).toBe(
        'EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)',
      )
    })

    it('p.has_media = 0 → NOT EXISTS(...)', () => {
      expect(rewriteLegacyAliases('p.has_media = 0')).toBe(
        'NOT EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)',
      )
    })

    it('p.media_count >= 3 → (SELECT COUNT(*) ...) >= 3', () => {
      expect(rewriteLegacyAliases('p.media_count >= 3')).toBe(
        '(SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= 3',
      )
    })

    it("p.has_spoiler = 1 → p.spoiler_text != ''", () => {
      expect(rewriteLegacyAliases('p.has_spoiler = 1')).toBe(
        "p.spoiler_text != ''",
      )
    })
  })

  // === v1 カラム名 → v2 カラム名 ===

  describe('v1 カラム名 → v2 カラム名の書き換え', () => {
    it('p.account_acct → pr.acct', () => {
      expect(rewriteLegacyAliases("p.account_acct = 'user'")).toBe(
        "pr.acct = 'user'",
      )
    })

    it('p.visibility → vt.name', () => {
      expect(rewriteLegacyAliases("p.visibility = 'public'")).toBe(
        "vt.name = 'public'",
      )
    })

    it('p.favourites_count → ps.favourites_count', () => {
      expect(rewriteLegacyAliases('p.favourites_count >= 10')).toBe(
        'ps.favourites_count >= 10',
      )
    })

    it('pbt.tag → ht.name', () => {
      expect(rewriteLegacyAliases("pbt.tag = 'photo'")).toBe(
        "ht.name = 'photo'",
      )
    })

    it('p.in_reply_to_id → p.in_reply_to_uri', () => {
      expect(rewriteLegacyAliases('p.in_reply_to_id IS NULL')).toBe(
        'p.in_reply_to_uri IS NULL',
      )
    })

    it('ntt.code → nt.name', () => {
      expect(rewriteLegacyAliases("ntt.code = 'follow'")).toBe(
        "nt.name = 'follow'",
      )
    })

    it('n.notification_type → nt.name', () => {
      expect(rewriteLegacyAliases("n.notification_type = 'mention'")).toBe(
        "nt.name = 'mention'",
      )
    })

    it('n.account_acct → ap.acct', () => {
      expect(rewriteLegacyAliases("n.account_acct = 'user'")).toBe(
        "ap.acct = 'user'",
      )
    })
  })

  // === エッジケース ===

  describe('エッジケース', () => {
    it('入力がv2形式ならそのまま返す', () => {
      const v2Where = "pr.acct = 'user' AND p.is_reblog = 0"
      expect(rewriteLegacyAliases(v2Where)).toBe(v2Where)
    })

    it("複合条件の書き換え: p.account_acct = 'user' AND p.has_media = 1", () => {
      const input = "p.account_acct = 'user' AND p.has_media = 1"
      const result = rewriteLegacyAliases(input)
      expect(result).toBe(
        "pr.acct = 'user' AND EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)",
      )
    })
  })
})
