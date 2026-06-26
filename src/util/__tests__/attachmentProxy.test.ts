import {
  isAllowedContentType,
  isPrivateHost,
  isRequestFromAllowedOrigin,
} from 'util/attachmentProxy'
import { describe, expect, it } from 'vitest'

describe('attachmentProxy', () => {
  describe('isPrivateHost', () => {
    it('IPv4 loopbackとプライベートアドレスを拒否する', () => {
      expect(isPrivateHost('localhost')).toBe(true)
      expect(isPrivateHost('127.0.0.1')).toBe(true)
      expect(isPrivateHost('10.0.0.1')).toBe(true)
      expect(isPrivateHost('192.168.1.1')).toBe(true)
    })

    it('IPv6 loopbackを拒否する', () => {
      expect(isPrivateHost('::1')).toBe(true)
      expect(isPrivateHost('[::1]')).toBe(true)
    })

    it('公開ホストを許可する', () => {
      expect(isPrivateHost('cdn.example.com')).toBe(false)
    })
  })

  describe('isAllowedContentType', () => {
    it('メディアContent-Typeを許可する', () => {
      expect(isAllowedContentType('image/jpeg')).toBe(true)
      expect(isAllowedContentType('audio/mpeg')).toBe(true)
      expect(isAllowedContentType('video/mp4')).toBe(true)
    })

    it('大文字小文字を区別しない', () => {
      expect(isAllowedContentType('Image/jpeg')).toBe(true)
      expect(isAllowedContentType('VIDEO/mp4')).toBe(true)
    })

    it('charset付きのContent-Typeを許可する', () => {
      expect(isAllowedContentType('image/png; charset=utf-8')).toBe(true)
    })

    it('非メディアContent-Typeを拒否する', () => {
      expect(isAllowedContentType('text/html')).toBe(false)
      expect(isAllowedContentType(null)).toBe(false)
    })
  })

  describe('isRequestFromAllowedOrigin', () => {
    const allowedDomains = ['miyulab-fe.vercel.app']

    it('許可ドメインのOriginを受け入れる', () => {
      expect(
        isRequestFromAllowedOrigin(
          null,
          'https://miyulab-fe.vercel.app',
          allowedDomains,
        ),
      ).toBe(true)
    })

    it('許可ドメインのRefererを受け入れる', () => {
      expect(
        isRequestFromAllowedOrigin(
          'https://miyulab-fe.vercel.app/timeline',
          null,
          allowedDomains,
        ),
      ).toBe(true)
    })

    it('部分一致によるバイパスを拒否する', () => {
      expect(
        isRequestFromAllowedOrigin(
          null,
          'https://evil-miyulab-fe.vercel.app.attacker.com',
          allowedDomains,
        ),
      ).toBe(false)
      expect(
        isRequestFromAllowedOrigin(
          null,
          'https://attacker.com/?miyulab-fe.vercel.app',
          allowedDomains,
        ),
      ).toBe(false)
    })
  })
})
