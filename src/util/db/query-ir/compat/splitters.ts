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

function handleQuoteChar(
  where: string,
  index: number,
  inString: boolean,
  current: string,
): { inString: boolean; current: string; skip: number } {
  if (!inString) {
    return { current: `${current}'`, inString: true, skip: 0 }
  }
  if (index + 1 < where.length && where[index + 1] === "'") {
    return { current: `${current}''`, inString: true, skip: 1 }
  }
  return { current: `${current}'`, inString: false, skip: 0 }
}

function trySplitAtDelimiter(
  where: string,
  index: number,
  depth: number,
  current: string,
  splitPattern: RegExp,
  parts: string[],
): { index: number; current: string; split: boolean } {
  if (depth !== 0) {
    return { current, index, split: false }
  }
  const match = splitPattern.exec(where.slice(index))
  if (!match) {
    return { current, index, split: false }
  }
  parts.push(current.trim())
  return {
    current: '',
    index: index + match[0].length - 1,
    split: true,
  }
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

    if (ch === "'") {
      const quote = handleQuoteChar(where, i, inString, current)
      inString = quote.inString
      current = quote.current
      i += quote.skip
      continue
    }
    if (inString) {
      current += ch
      continue
    }

    if (ch === '(') depth++
    if (ch === ')') depth--

    const split = trySplitAtDelimiter(
      where,
      i,
      depth,
      current,
      splitPattern,
      parts,
    )
    if (split.split) {
      i = split.index
      current = split.current
      continue
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
