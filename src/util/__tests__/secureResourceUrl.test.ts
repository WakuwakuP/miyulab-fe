import { toSecureResourceUrl } from 'util/secureResourceUrl'
import { describe, expect, it } from 'vitest'

describe('toSecureResourceUrl', () => {
  it('http URL を https URL に変換する', () => {
    expect(
      toSecureResourceUrl(
        'http://pleromedia.wakuwakup.net/video.mp4?name=test.mp4',
      ),
    ).toBe('https://pleromedia.wakuwakup.net/video.mp4?name=test.mp4')
  })

  it('protocol-relative URL を https URL に変換する', () => {
    expect(toSecureResourceUrl('//cdn.example.com/image.png')).toBe(
      'https://cdn.example.com/image.png',
    )
  })

  it('https URL はそのまま返す', () => {
    expect(toSecureResourceUrl('https://example.com/image.png')).toBe(
      'https://example.com/image.png',
    )
  })

  it('相対 URL と不正な URL はそのまま返す', () => {
    expect(toSecureResourceUrl('/local/image.png')).toBe('/local/image.png')
    expect(toSecureResourceUrl('not a url')).toBe('not a url')
  })

  it('空値は undefined を返す', () => {
    expect(toSecureResourceUrl('')).toBeUndefined()
    expect(toSecureResourceUrl(null)).toBeUndefined()
    expect(toSecureResourceUrl(undefined)).toBeUndefined()
  })
})
