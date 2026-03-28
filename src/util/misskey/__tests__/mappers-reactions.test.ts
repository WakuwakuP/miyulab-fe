import { describe, expect, it } from 'vitest'
import { mapReactions } from '../mappers'

describe('mapReactions', () => {
  // ================================================================
  // Unicode emoji
  // ================================================================
  describe('Unicode 絵文字', () => {
    it('Unicode 絵文字はそのまま name に設定され、url は含まれない', () => {
      const result = mapReactions({ '🎉': 3 })

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('🎉')
      expect(result[0].count).toBe(3)
      expect(result[0]).not.toHaveProperty('url')
      expect(result[0]).not.toHaveProperty('static_url')
    })

    it('myReaction と一致する Unicode 絵文字は me=true になる', () => {
      const result = mapReactions({ '👍': 1 }, '👍')

      expect(result[0].me).toBe(true)
    })

    it('myReaction と一致しない Unicode 絵文字は me=false になる', () => {
      const result = mapReactions({ '👍': 1 }, '🎉')

      expect(result[0].me).toBe(false)
    })
  })

  // ================================================================
  // Custom emoji with reactionEmojis provided
  // ================================================================
  describe('カスタム絵文字 — reactionEmojis あり', () => {
    it(':name@.: (ローカル) の URL を reactionEmojis から解決する', () => {
      const result = mapReactions({ ':blobcat@.:': 2 }, null, {
        blobcat: 'https://example.com/emoji/blobcat.webp',
      })

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe(':blobcat:')
      expect(result[0].count).toBe(2)
      expect(result[0].url).toBe('https://example.com/emoji/blobcat.webp')
      expect(result[0].static_url).toBe(
        'https://example.com/emoji/blobcat.webp',
      )
    })

    it(':name@host: (リモート) の URL を shortcode@host キーで解決する', () => {
      const result = mapReactions(
        { ':nekomimi@remote.example.com:': 1 },
        null,
        {
          'nekomimi@remote.example.com':
            'https://remote.example.com/emoji/nekomimi.webp',
        },
      )

      expect(result[0].name).toBe(':nekomimi:')
      expect(result[0].url).toBe(
        'https://remote.example.com/emoji/nekomimi.webp',
      )
    })

    it(':name@host: の URL を shortcode キーでもフォールバック解決する', () => {
      const result = mapReactions({ ':wave@remote.example.com:': 1 }, null, {
        wave: 'https://remote.example.com/emoji/wave.webp',
      })

      expect(result[0].name).toBe(':wave:')
      expect(result[0].url).toBe('https://remote.example.com/emoji/wave.webp')
    })

    it(':name: (ホスト無し) の URL を reactionEmojis から解決する', () => {
      const result = mapReactions({ ':parrot:': 1 }, null, {
        parrot: 'https://example.com/emoji/parrot.gif',
      })

      expect(result[0].name).toBe(':parrot:')
      expect(result[0].url).toBe('https://example.com/emoji/parrot.gif')
    })

    it('myReaction は raw name (:name@.:) と比較される', () => {
      const result = mapReactions({ ':blobcat@.:': 1 }, ':blobcat@.:', {
        blobcat: 'https://example.com/emoji/blobcat.webp',
      })

      expect(result[0].me).toBe(true)
    })
  })

  // ================================================================
  // Custom emoji with empty reactionEmojis — instanceHost fallback
  // ================================================================
  describe('カスタム絵文字 — reactionEmojis 空 + instanceHost フォールバック', () => {
    it(':name@.: で reactionEmojis が空の場合、instanceHost から URL を生成する', () => {
      const result = mapReactions(
        { ':umasou_gm@.:': 1 },
        null,
        {},
        'https://prismisskey.space',
      )

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe(':umasou_gm:')
      expect(result[0].count).toBe(1)
      expect(result[0].url).toBe(
        'https://prismisskey.space/emoji/umasou_gm.webp',
      )
      expect(result[0].static_url).toBe(
        'https://prismisskey.space/emoji/umasou_gm.webp',
      )
    })

    it(':name@.: で reactionEmojis が undefined の場合も instanceHost フォールバック', () => {
      const result = mapReactions(
        { ':sakura@.:': 1 },
        null,
        undefined,
        'https://misskey.example.com',
      )

      expect(result[0].name).toBe(':sakura:')
      expect(result[0].url).toBe(
        'https://misskey.example.com/emoji/sakura.webp',
      )
    })

    it(':name@host: (リモート) で reactionEmojis が空の場合、リモートホストから URL を生成する', () => {
      const result = mapReactions(
        { ':nyancat@remote.misskey.io:': 1 },
        null,
        {},
        'https://local.example.com',
      )

      expect(result[0].name).toBe(':nyancat:')
      expect(result[0].url).toBe('https://remote.misskey.io/emoji/nyancat.webp')
    })

    it(':name: (ホスト無し) で reactionEmojis が空の場合、instanceHost から URL を生成する', () => {
      const result = mapReactions(
        { ':thinking:': 1 },
        null,
        {},
        'https://misskey.example.com',
      )

      expect(result[0].name).toBe(':thinking:')
      expect(result[0].url).toBe(
        'https://misskey.example.com/emoji/thinking.webp',
      )
    })

    it('instanceHost も無い場合、url/static_url は含まれない', () => {
      const result = mapReactions({ ':unknown@.:': 1 }, null, {})

      expect(result[0].name).toBe(':unknown:')
      expect(result[0]).not.toHaveProperty('url')
      expect(result[0]).not.toHaveProperty('static_url')
    })

    it(':name: で instanceHost も reactionEmojis も無い場合、url は含まれない', () => {
      const result = mapReactions({ ':orphan:': 1 })

      expect(result[0].name).toBe(':orphan:')
      expect(result[0]).not.toHaveProperty('url')
      expect(result[0]).not.toHaveProperty('static_url')
    })
  })

  // ================================================================
  // Mixed reactions
  // ================================================================
  describe('混合リアクション', () => {
    it('Unicode 絵文字とカスタム絵文字が混在する場合、それぞれ正しく処理する', () => {
      const result = mapReactions(
        {
          ':umasou_gm@.:': 1,
          '🎉': 1,
        },
        null,
        {},
        'https://prismisskey.space',
      )

      expect(result).toHaveLength(2)

      const unicode = result.find((r) => r.name === '🎉')
      expect(unicode).toBeDefined()
      expect(unicode?.count).toBe(1)
      expect(unicode).not.toHaveProperty('url')

      const custom = result.find((r) => r.name === ':umasou_gm:')
      expect(custom).toBeDefined()
      expect(custom?.count).toBe(1)
      expect(custom?.url).toBe('https://prismisskey.space/emoji/umasou_gm.webp')
    })

    it('reactionEmojis で解決できるものとフォールバックが混在する', () => {
      const result = mapReactions(
        {
          ':fallback@.:': 3,
          ':known@.:': 2,
        },
        null,
        { known: 'https://cdn.example.com/emoji/known.png' },
        'https://misskey.example.com',
      )

      const known = result.find((r) => r.name === ':known:')
      expect(known?.url).toBe('https://cdn.example.com/emoji/known.png')

      const fallback = result.find((r) => r.name === ':fallback:')
      expect(fallback?.url).toBe(
        'https://misskey.example.com/emoji/fallback.webp',
      )
    })
  })

  // ================================================================
  // URL normalization (ensureAbsoluteUrl)
  // ================================================================
  describe('URL 正規化', () => {
    it('プロトコルが省略された URL に https:// が付与される', () => {
      const result = mapReactions({ ':test@.:': 1 }, null, {
        test: 'cdn.example.com/emoji/test.webp',
      })

      expect(result[0].url).toBe('https://cdn.example.com/emoji/test.webp')
    })

    it('既に https:// が付いている URL はそのまま保持される', () => {
      const result = mapReactions({ ':test@.:': 1 }, null, {
        test: 'https://cdn.example.com/emoji/test.webp',
      })

      expect(result[0].url).toBe('https://cdn.example.com/emoji/test.webp')
    })
  })

  // ================================================================
  // Edge cases
  // ================================================================
  describe('エッジケース', () => {
    it('空の reactions オブジェクトは空配列を返す', () => {
      const result = mapReactions({})

      expect(result).toEqual([])
    })

    it('count が 0 のリアクションもそのまま返す', () => {
      const result = mapReactions({ '👍': 0 })

      expect(result).toHaveLength(1)
      expect(result[0].count).toBe(0)
    })

    it('accounts は常に空配列', () => {
      const result = mapReactions(
        { ':cat@.:': 2, '👍': 1 },
        null,
        {},
        'https://example.com',
      )

      for (const r of result) {
        expect(r.accounts).toEqual([])
      }
    })
  })
})
