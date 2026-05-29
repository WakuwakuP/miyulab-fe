// ============================================================
// Top-level AND / OR splitters
// ============================================================
//
// 括弧のネストレベルを追跡して、トップレベルの AND / OR で分割する。

type TopLevelDelimiter = 'AND' | 'OR'

const TOP_LEVEL_SPLIT_PATTERN: Record<TopLevelDelimiter, RegExp> = {
  AND: /^\s+AND\s+/i,
  OR: /^\s+OR\s+/i,
}

/**
 * 括弧のネストレベルを追跡して、トップレベルの区切り文字で分割する。
 * 文字列リテラル内の区切りは無視する。
 */
function splitByTopLevel(
  where: string,
  delimiter: TopLevelDelimiter,
): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  let inString = false
  const splitPattern = TOP_LEVEL_SPLIT_PATTERN[delimiter]

  for (let i = 0; i < where.length; i++) {
    const ch = where[i]

    if (ch === "'" && !inString) {
      inString = true
      current += ch
      continue
    }
    if (ch === "'" && inString) {
      if (i + 1 < where.length && where[i + 1] === "'") {
        current += "''"
        i++
        continue
      }
      inString = false
      current += ch
      continue
    }
    if (inString) {
      current += ch
      continue
    }

    if (ch === '(') depth++
    if (ch === ')') depth--

    if (depth === 0) {
      const rest = where.slice(i)
      const match = rest.match(splitPattern)
      if (match) {
        parts.push(current.trim())
        i += match[0].length - 1
        current = ''
        continue
      }
    }

    current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/**
 * 括弧のネストレベルを追跡して、トップレベルの AND で分割する。
 * 文字列リテラル内の AND は無視する。
 */
export function splitByTopLevelAnd(where: string): string[] {
  return splitByTopLevel(where, 'AND')
}

/**
 * トップレベルの OR で分割する（mixed query の検出用）
 */
export function splitByTopLevelOr(where: string): string[] {
  return splitByTopLevel(where, 'OR')
}
