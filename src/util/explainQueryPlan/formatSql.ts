/**
 * SQL 文字列を読みやすい形にフォーマットする
 *
 * テンプレートリテラルの余分なインデントを除去し、
 * 空行を取り除いて先頭インデント 2 スペースに統一する。
 */
export function formatSql(sql: string): string {
  const lines = sql.split('\n')

  // 空行を除いた各行の先頭スペース数を取得し、最小値を共通インデントとする
  const indents = lines
    .filter((l) => l.trim().length > 0)
    .map((l) => l.match(/^(\s*)/)?.[1].length ?? 0)
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0

  return lines
    .map((l) => l.slice(minIndent))
    .filter((l) => l.trim().length > 0)
    .map((l) => `  ${l}`)
    .join('\n')
}
