import {
  compareSemVer,
  decodeSemVer,
  encodeSemVer,
  formatSemVer,
  LATEST_VERSION,
  normalizeLegacyVersion,
  parseSemVer,
} from 'util/db/sqlite/schema/version'
import { describe, expect, it } from 'vitest'

describe('encodeSemVer', () => {
  it('0.0.0 を 0 にエンコードする', () => {
    expect(encodeSemVer({ major: 0, minor: 0, patch: 0 })).toBe(0)
  })
  it('1.0.0 を 10000 にエンコードする', () => {
    expect(encodeSemVer({ major: 1, minor: 0, patch: 0 })).toBe(10000)
  })
  it('2.0.0 を 20000 にエンコードする', () => {
    expect(encodeSemVer({ major: 2, minor: 0, patch: 0 })).toBe(20000)
  })
  it('2.1.3 を 20103 にエンコードする', () => {
    expect(encodeSemVer({ major: 2, minor: 1, patch: 3 })).toBe(20103)
  })
  it('0.1.0 を 100 にエンコードする', () => {
    expect(encodeSemVer({ major: 0, minor: 1, patch: 0 })).toBe(100)
  })
  it('0.0.1 を 1 にエンコードする', () => {
    expect(encodeSemVer({ major: 0, minor: 0, patch: 1 })).toBe(1)
  })
  it('99.99.99 を 999999 にエンコードする', () => {
    expect(encodeSemVer({ major: 99, minor: 99, patch: 99 })).toBe(999999)
  })
})

describe('decodeSemVer', () => {
  it('0 を {0, 0, 0} にデコードする', () => {
    expect(decodeSemVer(0)).toEqual({ major: 0, minor: 0, patch: 0 })
  })
  it('10000 を {1, 0, 0} にデコードする', () => {
    expect(decodeSemVer(10000)).toEqual({ major: 1, minor: 0, patch: 0 })
  })
  it('20000 を {2, 0, 0} にデコードする', () => {
    expect(decodeSemVer(20000)).toEqual({ major: 2, minor: 0, patch: 0 })
  })
  it('20103 を {2, 1, 3} にデコードする', () => {
    expect(decodeSemVer(20103)).toEqual({ major: 2, minor: 1, patch: 3 })
  })
  it('レガシー値 28 を {0, 0, 28} として扱う', () => {
    expect(decodeSemVer(28)).toEqual({ major: 0, minor: 0, patch: 28 })
  })
  it('レガシー値 9999 を {0, 0, 9999} として扱う', () => {
    expect(decodeSemVer(9999)).toEqual({ major: 0, minor: 0, patch: 9999 })
  })
  it('10000以上の値で encodeSemVer の逆変換になる', () => {
    const versions = [
      { major: 1, minor: 0, patch: 0 },
      { major: 2, minor: 1, patch: 3 },
      { major: 5, minor: 12, patch: 99 },
    ]
    for (const v of versions) {
      expect(decodeSemVer(encodeSemVer(v))).toEqual(v)
    }
  })
})

describe('parseSemVer', () => {
  it('"1.0.0" をパースできる', () => {
    expect(parseSemVer('1.0.0')).toEqual({ major: 1, minor: 0, patch: 0 })
  })
  it('"2.1.3" をパースできる', () => {
    expect(parseSemVer('2.1.3')).toEqual({ major: 2, minor: 1, patch: 3 })
  })
  it('"0.0.0" をパースできる', () => {
    expect(parseSemVer('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0 })
  })
})

describe('formatSemVer', () => {
  it('{1, 0, 0} を "1.0.0" にフォーマットする', () => {
    expect(formatSemVer({ major: 1, minor: 0, patch: 0 })).toBe('1.0.0')
  })
  it('{2, 1, 3} を "2.1.3" にフォーマットする', () => {
    expect(formatSemVer({ major: 2, minor: 1, patch: 3 })).toBe('2.1.3')
  })
  it('{0, 0, 0} を "0.0.0" にフォーマットする', () => {
    expect(formatSemVer({ major: 0, minor: 0, patch: 0 })).toBe('0.0.0')
  })
})

describe('compareSemVer', () => {
  it('同じバージョンで 0 を返す', () => {
    expect(
      compareSemVer(
        { major: 2, minor: 0, patch: 0 },
        { major: 2, minor: 0, patch: 0 },
      ),
    ).toBe(0)
  })
  it('a < b (major) のとき -1 を返す', () => {
    expect(
      compareSemVer(
        { major: 1, minor: 0, patch: 0 },
        { major: 2, minor: 0, patch: 0 },
      ),
    ).toBe(-1)
  })
  it('a > b (major) のとき 1 を返す', () => {
    expect(
      compareSemVer(
        { major: 3, minor: 0, patch: 0 },
        { major: 2, minor: 0, patch: 0 },
      ),
    ).toBe(1)
  })
  it('a < b (minor) のとき -1 を返す', () => {
    expect(
      compareSemVer(
        { major: 2, minor: 0, patch: 0 },
        { major: 2, minor: 1, patch: 0 },
      ),
    ).toBe(-1)
  })
  it('a > b (patch) のとき 1 を返す', () => {
    expect(
      compareSemVer(
        { major: 2, minor: 0, patch: 5 },
        { major: 2, minor: 0, patch: 3 },
      ),
    ).toBe(1)
  })
})

describe('normalizeLegacyVersion', () => {
  it('pragmaValue 0 で {0, 0, 0} を返す（新規DB）', () => {
    expect(normalizeLegacyVersion(0)).toEqual({ major: 0, minor: 0, patch: 0 })
  })
  it('レガシー pragmaValue 28 で {1, 0, 0} を返す', () => {
    expect(normalizeLegacyVersion(28)).toEqual({ major: 1, minor: 0, patch: 0 })
  })
  it('レガシー pragmaValue 1 で {1, 0, 0} を返す', () => {
    expect(normalizeLegacyVersion(1)).toEqual({ major: 1, minor: 0, patch: 0 })
  })
  it('境界値 pragmaValue 9999 で {1, 0, 0} を返す', () => {
    expect(normalizeLegacyVersion(9999)).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
    })
  })
  it('境界値 pragmaValue 10000 で {1, 0, 0} を返す', () => {
    expect(normalizeLegacyVersion(10000)).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
    })
  })
  it('pragmaValue 20000 を {2, 0, 0} にデコードする', () => {
    expect(normalizeLegacyVersion(20000)).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
    })
  })
  it('pragmaValue 20103 を {2, 1, 3} にデコードする', () => {
    expect(normalizeLegacyVersion(20103)).toEqual({
      major: 2,
      minor: 1,
      patch: 3,
    })
  })
})

describe('LATEST_VERSION', () => {
  it('2.0.1 である', () => {
    expect(LATEST_VERSION).toEqual({ major: 2, minor: 0, patch: 1 })
  })
  it('20001 にエンコードされる', () => {
    expect(encodeSemVer(LATEST_VERSION)).toBe(20001)
  })
})
