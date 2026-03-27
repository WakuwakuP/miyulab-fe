import type { Entity } from 'megalodon'

export type PostColumns = {
  object_uri: string
  canonical_url: string | null
  content_html: string
  created_at_ms: number
  edited_at_ms: number | null
  plain_content: string | null
  language: string | null
  is_sensitive: number // 0 or 1
  spoiler_text: string
  visibility_id: number
  in_reply_to_uri: string | null
  in_reply_to_account_acct: string | null
  quote_state: string | null
  is_local_only: number // 0 or 1
  application_name: string | null
}

const VISIBILITY_MAP: Record<string, number> = {
  direct: 4,
  private: 3,
  public: 1,
  unlisted: 2,
}

/**
 * Entity.Status から正規化カラムの値を抽出する
 */
export function extractPostColumns(status: Entity.Status): PostColumns {
  // mentions から in_reply_to_account_id に一致するアカウントの acct を解決する
  let inReplyToAccountAcct: string | null = null
  const replyAccountId = (status as Record<string, unknown>)
    .in_reply_to_account_id as string | null | undefined
  if (replyAccountId != null && Array.isArray(status.mentions)) {
    const matched = status.mentions.find(
      (m: Entity.Mention) => m.id === replyAccountId,
    )
    if (matched) {
      inReplyToAccountAcct = matched.acct
    }
  }

  // quote 関連: megalodon の型定義にはないが実データに存在し得るフィールド
  const statusAny = status as Record<string, unknown>
  const quote = statusAny.quote as Entity.Status | null | undefined
  const quoteState: string | null = quote != null ? 'accepted' : null

  // plain_content: megalodon の型定義にはないがバックエンドによっては存在する
  const plainContent =
    (statusAny.plain_content as string | null | undefined) ?? null

  return {
    application_name: status.application?.name ?? null,
    canonical_url: status.url ?? null,
    content_html: status.content ?? '',
    created_at_ms: new Date(status.created_at).getTime(),
    edited_at_ms: status.edited_at
      ? new Date(status.edited_at).getTime()
      : null,
    in_reply_to_account_acct: inReplyToAccountAcct,
    in_reply_to_uri: status.in_reply_to_id ?? null,
    is_local_only: 0,
    is_sensitive: status.sensitive ? 1 : 0,
    language: status.language ?? null,
    object_uri: status.uri,
    plain_content: plainContent,
    quote_state: quoteState,
    spoiler_text: status.spoiler_text ?? '',
    visibility_id: VISIBILITY_MAP[status.visibility] ?? 1,
  }
}
