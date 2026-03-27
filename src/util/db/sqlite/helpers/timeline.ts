/**
 * タイムラインのキー文字列を構築する。
 * timeline_entries.timeline_key カラムに格納する値。
 *
 * 形式:
 *   - "home", "local", "public", "public:local"
 *   - "tag:<tagName>"
 *   - "list:<listId>"
 *   - "user:<acct>"  (ユーザータイムライン)
 *   - それ以外はそのまま返す
 */
export function buildTimelineKey(
  type: string,
  options?: { tag?: string; listId?: string; acct?: string },
): string {
  switch (type) {
    case 'home':
    case 'local':
    case 'public':
    case 'public:local':
      return type
    case 'tag':
      return `tag:${options?.tag ?? ''}`
    case 'list':
      return `list:${options?.listId ?? ''}`
    case 'user':
      return `user:${options?.acct ?? ''}`
    default:
      return type
  }
}
