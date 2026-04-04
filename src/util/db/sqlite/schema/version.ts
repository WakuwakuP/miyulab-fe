/**
 * セマンティックバージョニング型とユーティリティ
 *
 * SQLite の PRAGMA user_version (整数) との相互変換をサポート。
 * エンコード: major * 10000 + minor * 100 + patch
 */

export type SemVer = {
  major: number
  minor: number
  patch: number
}

export function encodeSemVer(v: SemVer): number {
  return v.major * 10000 + v.minor * 100 + v.patch
}

export function decodeSemVer(encoded: number): SemVer {
  if (encoded > 0 && encoded < 10000) {
    return { major: 0, minor: 0, patch: encoded }
  }
  return {
    major: Math.floor(encoded / 10000),
    minor: Math.floor((encoded % 10000) / 100),
    patch: encoded % 100,
  }
}

export function parseSemVer(str: string): SemVer {
  const [major, minor, patch] = str.split('.').map(Number)
  return { major, minor, patch }
}

export function formatSemVer(v: SemVer): string {
  return `${v.major}.${v.minor}.${v.patch}`
}

export function compareSemVer(a: SemVer, b: SemVer): -1 | 0 | 1 {
  const ea = encodeSemVer(a)
  const eb = encodeSemVer(b)
  return ea < eb ? -1 : ea > eb ? 1 : 0
}

export const LATEST_VERSION: SemVer = { major: 2, minor: 0, patch: 3 }

export function normalizeLegacyVersion(pragmaValue: number): SemVer {
  if (pragmaValue === 0) {
    return { major: 0, minor: 0, patch: 0 }
  }
  if (pragmaValue <= 10000) {
    return { major: 1, minor: 0, patch: 0 }
  }
  return decodeSemVer(pragmaValue)
}
