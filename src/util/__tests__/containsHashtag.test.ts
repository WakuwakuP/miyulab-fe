import { containsHashtag } from 'util/containsHashtag'
import { describe, expect, it } from 'vitest'

describe('containsHashtag', () => {
  it('#tag を含む本文は true', () => {
    expect(containsHashtag('hello #tag')).toBe(true)
  })

  it('複数タグを含む本文は true', () => {
    expect(containsHashtag('#foo and #bar')).toBe(true)
  })

  it('# のみは false', () => {
    expect(containsHashtag('#')).toBe(false)
  })

  it('空白のみは false', () => {
    expect(containsHashtag('   ')).toBe(false)
  })

  it('メンションのみは false', () => {
    expect(containsHashtag('@user hello')).toBe(false)
  })

  it('空文字は false', () => {
    expect(containsHashtag('')).toBe(false)
  })
})
