/**
 * ストリーム接続の一意識別キー
 *
 * セパレータに `|` を使用する。
 * backendUrl（`https://...`）やタグ名にコロンが含まれ得るため、
 * コロン区切りでは安全にパースできない。
 * `|` は URL やハッシュタグに出現しないため安全なセパレータとなる。
 *
 * - local:   `local|${backendUrl}`
 * - public:  `public|${backendUrl}`
 * - tag:     `tag|${backendUrl}|${tagName}`
 *
 * userStreaming は StatusStoreProvider で管理するため対象外。
 */

const STREAM_KEY_SEPARATOR = '|'

export type StreamType = 'local' | 'public' | 'tag'

export function createStreamKey(
  type: StreamType,
  backendUrl: string,
  tag?: string,
): string {
  if (type === 'tag' && tag != null) {
    return [type, backendUrl, tag].join(STREAM_KEY_SEPARATOR)
  }
  return [type, backendUrl].join(STREAM_KEY_SEPARATOR)
}

export function parseStreamKey(key: string): {
  backendUrl: string
  tag?: string
  type: StreamType
} {
  const parts = key.split(STREAM_KEY_SEPARATOR)
  // 形式: "type|backendUrl" or "tag|backendUrl|tagName"
  // セパレータが `|` のため、backendUrl 内のコロンやタグ名のコロンに影響されない
  const type = parts[0] as StreamType

  if (type === 'tag') {
    // "tag|https://example.com|tagname"
    // parts = ["tag", "https://example.com", "tagname"]
    return { backendUrl: parts[1], tag: parts[2], type }
  }

  // "local|https://example.com" or "public|https://example.com"
  return { backendUrl: parts[1], type }
}
