import { lookup } from 'node:dns/promises'
import {
  createProxyAccessToken,
  isAllowedContentType,
  isAllowedRequestHost,
  isPrivateHost,
  isPrivateHostWithDns,
  isRequestFromAllowedOrigin,
  verifyProxyAccessToken,
} from 'util/attachmentProxy'
import { describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}))

const mockedLookup = vi.mocked(lookup)

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

    it('IPv4-mapped IPv6 loopbackを拒否する', () => {
      expect(isPrivateHost('::ffff:127.0.0.1')).toBe(true)
      expect(isPrivateHost('[::ffff:127.0.0.1]')).toBe(true)
    })

    it('IPv6 link-localとULAを拒否する', () => {
      expect(isPrivateHost('fe80::1')).toBe(true)
      expect(isPrivateHost('fd12:3456:789a:1::1')).toBe(true)
      expect(isPrivateHost('fc00::1')).toBe(true)
    })

    it('公開ホストを許可する', () => {
      expect(isPrivateHost('cdn.example.com')).toBe(false)
      expect(isPrivateHost('2001:db8::1')).toBe(false)
    })

    it('127.0.0.0/8のループバック範囲を拒否する', () => {
      expect(isPrivateHost('127.0.0.2')).toBe(true)
      expect(isPrivateHost('127.255.255.255')).toBe(true)
    })
  })

  describe('isPrivateHostWithDns', () => {
    it('DNS解決後にプライベートIPへ解決するドメインを拒否する', async () => {
      mockedLookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }])

      await expect(isPrivateHostWithDns('cdn.example.com')).resolves.toBe(true)
    })

    it('DNS解決後に公開IPへ解決するドメインを許可する', async () => {
      mockedLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])

      await expect(isPrivateHostWithDns('cdn.example.com')).resolves.toBe(false)
    })

    it('DNS解決結果にプライベートIPが含まれる場合は拒否する', async () => {
      mockedLookup.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '192.168.1.1', family: 4 },
      ])

      await expect(isPrivateHostWithDns('cdn.example.com')).resolves.toBe(true)
    })

    it('DNS解決に失敗した場合は拒否する', async () => {
      mockedLookup.mockRejectedValue(new Error('ENOTFOUND'))

      await expect(isPrivateHostWithDns('cdn.example.com')).resolves.toBe(true)
    })

    it('リテラルIPにはDNS解決を行わない', async () => {
      mockedLookup.mockClear()

      await expect(isPrivateHostWithDns('93.184.216.34')).resolves.toBe(false)
      expect(mockedLookup).not.toHaveBeenCalled()
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

  describe('isAllowedRequestHost', () => {
    const allowedDomains = ['miyulab-fe.vercel.app']

    it('許可ドメインのHostを受け入れる', () => {
      expect(
        isAllowedRequestHost('miyulab-fe.vercel.app', allowedDomains),
      ).toBe(true)
      expect(
        isAllowedRequestHost('miyulab-fe.vercel.app:443', allowedDomains),
      ).toBe(true)
    })

    it('不一致のHostを拒否する', () => {
      expect(isAllowedRequestHost('attacker.com', allowedDomains)).toBe(false)
      expect(isAllowedRequestHost(null, allowedDomains)).toBe(false)
    })
  })

  describe('proxy access token', () => {
    it('トークンを生成して検証できる', async () => {
      const token = await createProxyAccessToken()
      expect(token).toBeTruthy()
      await expect(verifyProxyAccessToken(token)).resolves.toBe(true)
    })

    it('不正なトークンを拒否する', async () => {
      await expect(verifyProxyAccessToken('invalid.token')).resolves.toBe(false)
      await expect(verifyProxyAccessToken(null)).resolves.toBe(false)
    })
  })
})
