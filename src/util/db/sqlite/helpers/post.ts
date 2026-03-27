import type { Entity } from 'megalodon'

/**
 * Entity.Status から正規化カラムの値を抽出する
 */
export function extractStatusColumns(status: Entity.Status) {
  return {
    canonical_url: status.url ?? null,
    content_html: status.content ?? null,
    edited_at: status.edited_at ?? null,
    has_media: status.media_attachments.length > 0 ? 1 : 0,
    has_spoiler: (status.spoiler_text ?? '') !== '' ? 1 : 0,
    in_reply_to_id: status.in_reply_to_id ?? null,
    is_reblog: status.reblog != null ? 1 : 0,
    is_sensitive: status.sensitive ? 1 : 0,
    language: status.language ?? null,
    media_count: status.media_attachments.length,
    reblog_of_uri: status.reblog?.uri ?? null,
    spoiler_text: status.spoiler_text ?? null,
    uri: status.uri,
    visibility: status.visibility,
  }
}
