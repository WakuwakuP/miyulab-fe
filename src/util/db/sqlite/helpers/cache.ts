// ================================================================
// セッション中不変のマスターデータキャッシュ
// Worker / メインスレッド両方で使用。一度 DB から取得した値を保持する。
// ================================================================

export const channelKindCache = new Map<string, number>()
export const serverCache = new Map<string, number>()
export const timelineCache = new Map<string, number>()
export const localAccountCache = new Map<string, number | null>()
export const profileIdCache = new Map<string, number>()
export const customEmojiIdCache = new Map<string, number>()

/**
 * compositeKey を生成する
 *
 * @deprecated v7 以降は post_id (INTEGER PK) を使用。Dexie 互換用に残す。
 */
export function createCompositeKey(backendUrl: string, id: string): string {
  return `${backendUrl}:${id}`
}

/** 全キャッシュをクリアする */
export function clearAllCaches(): void {
  channelKindCache.clear()
  serverCache.clear()
  timelineCache.clear()
  localAccountCache.clear()
  profileIdCache.clear()
  customEmojiIdCache.clear()
}
