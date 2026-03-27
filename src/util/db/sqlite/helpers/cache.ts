// ================================================================
// セッション中不変のマスターデータキャッシュ
// Worker / メインスレッド両方で使用。一度 DB から取得した値を保持する。
// ================================================================

/** host → servers.id */
export const serverIdCache = new Map<string, number>()

/** acct (FQN: username@domain) → profiles.id */
export const profileIdCache = new Map<string, number>()

/** "server_id:shortcode" → custom_emojis.id */
export const emojiIdCache = new Map<string, number>()

/** backend_url → local_accounts.id | null */
export const localAccountIdCache = new Map<string, number | null>()

/** 全キャッシュをクリアする */
export function clearAllCaches(): void {
  serverIdCache.clear()
  profileIdCache.clear()
  emojiIdCache.clear()
  localAccountIdCache.clear()
}
