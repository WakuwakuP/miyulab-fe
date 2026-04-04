// ============================================================
// Top-level AND / OR splitters
// ============================================================
//
// 括弧のネストレベルを追跡して、トップレベルの AND / OR で分割する。

/**
 * 括弧のネストレベルを追跡して、トップレベルの AND で分割する。
 * 文字列リテラル内の AND は無視する。
 */
export function splitByTopLevelAnd(where: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  let inString = false

  for (let i = 0; i < where.length; i++) {
    const ch = where[i]

    // シングルクォート文字列の追跡
    if (ch === "'" && !inString) {
      inString = true
      current += ch
      continue
    }
    if (ch === "'" && inString) {
      // エスケープされた '' をチェック
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

    // トップレベルの AND を検出
    if (depth === 0) {
      const rest = where.slice(i)
      const andMatch = rest.match(/^\s+AND\s+/i)
      if (andMatch) {
        parts.push(current.trim())
        i += andMatch[0].length - 1
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
 * トップレベルの OR で分割する（mixed query の検出用）
 */
export function splitByTopLevelOr(where: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  let inString = false

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
      const orMatch = rest.match(/^\s+OR\s+/i)
      if (orMatch) {
        parts.push(current.trim())
        i += orMatch[0].length - 1
        current = ''
        continue
      }
    }

    current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}
