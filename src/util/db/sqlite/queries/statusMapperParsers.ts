/**
 * Status マッピング用の共通パーサー群
 *
 * JSON カラムのパース、型変換などインライン / バッチ両マッパーで
 * 共有されるユーティリティを集約する。
 */

import type { Entity } from 'megalodon'
import type { InteractionsJson } from './statusMapperTypes'

/**
 * emoji_reactions_json カラムの JSON 文字列を Entity.Reaction[] にパースする
 */
export function parseEmojiReactions(json: string | null): Entity.Reaction[] {
  if (!json) return []
  try {
    return JSON.parse(json) as Entity.Reaction[]
  } catch {
    return []
  }
}

/** カスタム絵文字 JSON をパースする */
export function parseEmojis(json: string | null): Entity.Emoji[] {
  if (!json) return []
  const parsed = JSON.parse(json) as ({
    shortcode: string
    url: string
    static_url: string | null
    visible_in_picker: number
  } | null)[]
  return parsed
    .filter(
      (e): e is NonNullable<typeof e> => e !== null && e.shortcode !== null,
    )
    .map((e) => ({
      shortcode: e.shortcode,
      static_url: e.static_url ?? e.url,
      url: e.url,
      visible_in_picker: e.visible_in_picker === 1,
    }))
}

/** メディア添付 JSON をパースする */
export function parseMediaAttachments(
  json: string | null,
): Entity.Attachment[] {
  if (!json) return []
  return (JSON.parse(json) as (Entity.Attachment | null)[]).filter(
    (m): m is Entity.Attachment => m !== null,
  )
}

/**
 * メンション JSON をパースする
 *
 * 新スキーマでは post_mentions に username, url が格納されている。
 */
export function parseMentions(json: string | null): Entity.Mention[] {
  if (!json) return []
  return (
    JSON.parse(json) as ({
      acct: string
      username?: string
      url?: string
    } | null)[]
  )
    .filter(
      (m): m is { acct: string; username?: string; url?: string } => m !== null,
    )
    .map((m) => ({
      acct: m.acct,
      id: '',
      url: m.url ?? '',
      username: m.username ?? m.acct.split('@')[0] ?? '',
    }))
}

/**
 * インラインクエリ用 poll パーサー（STATUS_SELECT から取得した poll_json 用）
 *
 * STATUS_SELECT の poll サブクエリには voted / own_votes が含まれないため、
 * voted は false 固定、own_votes は省略する。
 */
export function parseInlinePoll(json: string): Entity.Poll {
  const p = JSON.parse(json) as {
    id: number
    expires_at: string | null
    multiple: number
    votes_count: number
    options: string | { title: string; votes_count: number | null }[]
  }
  const options =
    typeof p.options === 'string'
      ? (JSON.parse(p.options) as {
          title: string
          votes_count: number | null
        }[])
      : p.options
  return {
    expired: p.expires_at ? new Date(p.expires_at) < new Date() : false,
    expires_at: p.expires_at,
    id: String(p.id),
    multiple: p.multiple === 1,
    options: options.map((o) => ({
      title: o.title,
      votes_count: o.votes_count,
    })),
    voted: false,
    votes_count: p.votes_count,
  }
}

/**
 * バッチクエリ用 poll パーサー（BATCH_POLLS_SQL から取得した poll_json 用）
 *
 * バッチクエリでは poll_votes JOIN により voted / own_votes が含まれる。
 */
export function parseBatchPoll(json: string): Entity.Poll {
  const p = JSON.parse(json) as {
    id: number
    expires_at: string | null
    expired: number | null
    multiple: number
    votes_count: number
    options: string | { title: string; votes_count: number | null }[]
    voted: number | null
    own_votes: string | number[] | null
  }
  const options =
    typeof p.options === 'string'
      ? (JSON.parse(p.options) as {
          title: string
          votes_count: number | null
        }[])
      : p.options

  let ownVotes: number[] | undefined
  if (p.own_votes != null) {
    try {
      ownVotes =
        typeof p.own_votes === 'string'
          ? (JSON.parse(p.own_votes) as number[])
          : p.own_votes
    } catch {
      ownVotes = undefined
    }
  }

  return {
    expired:
      p.expired != null
        ? p.expired === 1
        : p.expires_at
          ? new Date(p.expires_at) < new Date()
          : false,
    expires_at: p.expires_at,
    id: String(p.id),
    multiple: p.multiple === 1,
    options: options.map((o) => ({
      title: o.title,
      votes_count: o.votes_count,
    })),
    voted: p.voted === 1,
    votes_count: p.votes_count,
    ...(ownVotes ? { own_votes: ownVotes } : {}),
  }
}

/**
 * edited_at_ms (INTEGER | null) を ISO 文字列 | null に変換する
 */
export function editedAtMsToIso(ms: number | null): string | null {
  return ms != null ? new Date(ms).toISOString() : null
}

/** interactions JSON をパースして返す（null なら null） */
export function parseInteractions(
  json: string | null,
): InteractionsJson | null {
  if (!json) return null
  try {
    return JSON.parse(json) as InteractionsJson
  } catch {
    return null
  }
}
