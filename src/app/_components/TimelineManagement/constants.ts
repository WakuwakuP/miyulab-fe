/** タブグループの色テーマパレット（フォルダ数に応じてローテーション） */
export const TAB_GROUP_COLOR_PALETTE: {
  border: string
  header: string
  text: string
}[] = [
  {
    border: 'border-blue-500/50',
    header: 'bg-blue-900/30',
    text: 'text-blue-400',
  },
  {
    border: 'border-emerald-500/50',
    header: 'bg-emerald-900/30',
    text: 'text-emerald-400',
  },
  {
    border: 'border-amber-500/50',
    header: 'bg-amber-900/30',
    text: 'text-amber-400',
  },
  {
    border: 'border-purple-500/50',
    header: 'bg-purple-900/30',
    text: 'text-purple-400',
  },
  {
    border: 'border-rose-500/50',
    header: 'bg-rose-900/30',
    text: 'text-rose-400',
  },
  {
    border: 'border-cyan-500/50',
    header: 'bg-cyan-900/30',
    text: 'text-cyan-400',
  },
]

/** フォルダキーに対応する色を取得（パレットをローテーション） */
export function getFolderColors(
  groupKey: string,
  allKeys: string[],
): { border: string; header: string; text: string } {
  const index = allKeys.indexOf(groupKey)
  const palette = TAB_GROUP_COLOR_PALETTE
  if (index >= 0) {
    return palette[index % palette.length]
  }
  return {
    border: 'border-gray-500/50',
    header: 'bg-gray-800',
    text: 'text-gray-400',
  }
}

/**
 * UUID v4 の簡易生成
 * crypto.randomUUID が使えない環境へのフォールバック付き
 */
let fallbackIdCounter = 0

export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  fallbackIdCounter = (fallbackIdCounter + 1) % Number.MAX_SAFE_INTEGER

  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}-${fallbackIdCounter.toString(36)}`
}
