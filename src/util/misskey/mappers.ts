import type { Entity } from 'megalodon'
import type * as Misskey from 'misskey-js'

// ========================================
// URL Normalization
// ========================================

/** プロトコルが省略された URL に https:// を付与する */
export function ensureAbsoluteUrl(url: string): string {
  if (!url) return url
  if (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('/')
  )
    return url
  return `https://${url}`
}

// ========================================
// Misskey Note Extension Fields
// misskey-js の型定義に含まれないが実データに存在するフィールド
// ========================================

interface MisskeyNoteExtensions {
  /** 投稿編集日時 (Misskey 13+) */
  updatedAt?: string | null
  /** 自分がお気に入り済みか (API レスポンスのみ、ストリーミングでは欠落) */
  isFavorited?: boolean
  /** 自分がリノートした際のノート ID (API レスポンスのみ) */
  myRenoteId?: string | null
}

type MisskeyNoteWithExtensions = Misskey.entities.Note & MisskeyNoteExtensions

// ========================================
// Misskey UserDetailed Extension Fields
// misskey-js の型定義と実データの差異を吸収するフィールド
// ========================================

interface MisskeyUserDetailedExtensions {
  createdAt?: string
  description?: string | null
  followersCount?: number
  followingCount?: number
  notesCount?: number
  isLocked?: boolean
  fields?: Array<{ name: string; value: string }>
  bannerUrl?: string | null
}

type MisskeyUserDetailedWithExtensions = Misskey.entities.UserDetailed &
  MisskeyUserDetailedExtensions

// ========================================
// Visibility Mapping
// ========================================

export function mapVisibility(
  v: 'public' | 'home' | 'followers' | 'specified',
): Entity.StatusVisibility {
  switch (v) {
    case 'public':
      return 'public'
    case 'home':
      return 'unlisted'
    case 'followers':
      return 'private'
    case 'specified':
      return 'direct'
  }
}

export function mapVisibilityToMisskey(
  v: string,
): 'public' | 'home' | 'followers' | 'specified' {
  switch (v) {
    case 'public':
      return 'public'
    case 'unlisted':
      return 'home'
    case 'private':
      return 'followers'
    case 'direct':
      return 'specified'
    default:
      return 'public'
  }
}

// ========================================
// Emoji Mapping
// ========================================

export function mapEmojis(
  emojis: Record<string, string> | undefined,
): Entity.Emoji[] {
  if (!emojis) return []
  return Object.entries(emojis).map(([shortcode, rawUrl]) => {
    const url = ensureAbsoluteUrl(rawUrl)
    return {
      shortcode,
      static_url: url,
      url,
      visible_in_picker: true,
    }
  })
}

// ========================================
// DriveFile → Attachment
// ========================================

function getAttachmentType(
  mimeType: string,
): 'image' | 'video' | 'audio' | 'gifv' | 'unknown' {
  if (mimeType.startsWith('image/gif')) return 'gifv'
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return 'unknown'
}

export function mapDriveFileToAttachment(
  file: Misskey.entities.DriveFile,
): Entity.Attachment {
  return {
    blurhash: file.blurhash ?? null,
    description: file.comment ?? null,
    id: file.id,
    meta: file.properties
      ? {
          height: file.properties.height,
          width: file.properties.width,
        }
      : null,
    preview_url: file.thumbnailUrl ?? null,
    remote_url: null,
    text_url: null,
    type: getAttachmentType(file.type),
    url: file.url,
  }
}

// ========================================
// UserLite → Account
// ========================================

export function mapUserLiteToAccount(
  user: Misskey.entities.UserLite,
  instanceHost?: string,
): Entity.Account {
  const acct = user.host ? `${user.username}@${user.host}` : user.username
  const userUrl = user.host
    ? `https://${user.host}/@${user.username}`
    : instanceHost
      ? `${instanceHost}/@${user.username}`
      : ''

  return {
    acct,
    avatar: user.avatarUrl,
    avatar_static: user.avatarUrl,
    bot: user.isBot ?? null,
    created_at: '',
    display_name: user.name ?? user.username,
    emojis: mapEmojis(user.emojis),
    fields: [],
    followers_count: 0,
    following_count: 0,
    group: null,
    header: '',
    header_static: '',
    id: user.id,
    limited: null,
    locked: false,
    moved: null,
    noindex: null,
    note: '',
    statuses_count: 0,
    suspended: null,
    url: userUrl,
    username: user.username,
  }
}

// ========================================
// UserDetailed → Account (with full profile)
// ========================================

export function mapUserDetailedToAccount(
  user: Misskey.entities.UserDetailed,
  instanceHost?: string,
): Entity.Account {
  const base = mapUserLiteToAccount(user, instanceHost)
  const detailed = user as MisskeyUserDetailedWithExtensions

  return {
    ...base,
    created_at: detailed.createdAt ?? '',
    fields: (detailed.fields ?? []).map((f) => ({
      name: f.name,
      value: f.value,
      verified_at: null,
    })),
    followers_count: detailed.followersCount ?? 0,
    following_count: detailed.followingCount ?? 0,
    header: detailed.bannerUrl ?? '',
    header_static: detailed.bannerUrl ?? '',
    locked: detailed.isLocked ?? false,
    note: detailed.description ?? '',
    statuses_count: detailed.notesCount ?? 0,
  }
}

// ========================================
// Emoji Reactions → megalodon Reaction[]
// ========================================

/**
 * Normalize a Misskey reaction name and resolve its emoji URL.
 *
 * Misskey custom emoji reactions use `:name@.:` for local emoji.
 * This strips the `@.` suffix and looks up the URL in reactionEmojis.
 */
function normalizeReaction(
  name: string,
  reactionEmojis?: Record<string, string>,
  instanceHost?: string,
): { name: string; url: string | null } {
  // Custom emoji: `:name@.:` (local) or `:name@host:` (remote)
  const customMatch = name.match(/^:(.+?)@(.+?):$/)
  if (customMatch) {
    const shortcode = customMatch[1]
    const host = customMatch[2]
    const url =
      reactionEmojis?.[shortcode] ??
      reactionEmojis?.[`${shortcode}@${host}`] ??
      null
    if (url) {
      return { name: `:${shortcode}:`, url: ensureAbsoluteUrl(url) }
    }
    // Fallback: construct emoji URL from instance host
    // Local emoji (host=".") → use own instance, remote → use remote host
    const fallbackBase = host === '.' ? instanceHost : `https://${host}`
    const fallbackUrl = fallbackBase
      ? `${fallbackBase}/emoji/${shortcode}.webp`
      : null
    return { name: `:${shortcode}:`, url: fallbackUrl }
  }

  // Custom emoji without host: `:name:` (already normalized)
  if (name.startsWith(':') && name.endsWith(':')) {
    const shortcode = name.slice(1, -1)
    const url = reactionEmojis?.[shortcode] ?? null
    if (url) {
      return { name, url: ensureAbsoluteUrl(url) }
    }
    // Fallback: try constructing URL from instance host
    const fallbackUrl = instanceHost
      ? `${instanceHost}/emoji/${shortcode}.webp`
      : null
    return { name, url: fallbackUrl }
  }

  // Unicode emoji — return as-is
  return { name, url: null }
}

export function mapReactions(
  reactions: Record<string, number>,
  myReaction?: string | null,
  reactionEmojis?: Record<string, string>,
  instanceHost?: string,
): Entity.Reaction[] {
  return Object.entries(reactions).map(([rawName, count]) => {
    const r = normalizeReaction(rawName, reactionEmojis, instanceHost)

    return {
      accounts: [],
      count,
      me: myReaction === rawName,
      name: r.name,
      // Only include static_url/url if it's a custom emoji with a known URL
      ...(r.url ? { static_url: r.url, url: r.url } : {}),
    } as Entity.Reaction
  })
}

// ========================================
// Note → Status
// ========================================

export function mapNoteToStatus(
  note: Misskey.entities.Note,
  instanceHost?: string,
): Entity.Status {
  const ext = note as MisskeyNoteWithExtensions
  const account = mapUserLiteToAccount(note.user, instanceHost)
  const host = instanceHost ?? ''
  const uri = note.uri ?? `${host}/notes/${note.id}`
  const url = note.url ?? note.uri ?? `${host}/notes/${note.id}`

  // Handle renote (reblog)
  const isRenote =
    note.renote != null &&
    note.text == null &&
    (note.fileIds?.length ?? 0) === 0
  const reblog =
    isRenote && note.renote ? mapNoteToStatus(note.renote, instanceHost) : null

  // Build content from text (MFM → HTML with mentions, hashtags, URLs)
  const content = note.text ? mfmToHtml(note.text, instanceHost) : ''

  // Extract mentions from text with enriched data
  const mentions = note.text
    ? parseMentionsFromText(note.text, note.mentions ?? [], instanceHost)
    : (note.mentions ?? []).map((id) => ({
        acct: '',
        id,
        url: '',
        username: '',
      }))

  return {
    account,
    application: null,
    bookmarked: ext.isFavorited ?? false,
    card: null,
    content,
    created_at: note.createdAt,
    edited_at: ext.updatedAt ?? null,
    emoji_reactions: mapReactions(
      note.reactions ?? {},
      note.myReaction,
      note.reactionEmojis,
      instanceHost,
    ),
    emojis: mapEmojis(note.emojis),
    favourited: note.myReaction != null ? true : null,
    favourites_count: note.reactionCount ?? 0,
    id: note.id,
    in_reply_to_account_id: note.reply?.userId ?? null,
    in_reply_to_id: note.replyId ?? null,
    language: null,
    media_attachments: (note.files ?? []).map(mapDriveFileToAttachment),
    mentions,
    muted: null,
    pinned: null,
    plain_content: note.text ?? null,
    poll: note.poll
      ? {
          expired: note.poll.expiresAt
            ? new Date(note.poll.expiresAt).getTime() < Date.now()
            : false,
          expires_at: note.poll.expiresAt ?? null,
          id: note.id,
          multiple: note.poll.multiple,
          options: note.poll.choices.map((c) => ({
            title: c.text,
            votes_count: c.votes,
          })),
          voted: note.poll.choices.some((c) => c.isVoted),
          votes_count: note.poll.choices.reduce(
            (sum, c) => sum + (c.votes ?? 0),
            0,
          ),
        }
      : null,
    quote:
      note.renote && !isRenote
        ? {
            quoted_status: mapNoteToStatus(note.renote, instanceHost),
            state: 'accepted' as Entity.QuoteState,
          }
        : null,
    quote_approval: null as unknown as Entity.Status['quote_approval'],
    reblog,
    reblogged: ext.myRenoteId != null ? true : null,
    reblogs_count: note.renoteCount ?? 0,
    replies_count: note.repliesCount ?? 0,
    sensitive: (note.files ?? []).some((f) => f.isSensitive),
    spoiler_text: note.cw ?? '',
    tags: (note.tags ?? []).map((tag) => ({
      name: tag,
      url: `${host}/tags/${tag}`,
    })),
    uri,
    url,
    visibility: mapVisibility(note.visibility),
  }
}

// ========================================
// Notification → megalodon Notification
// ========================================

function mapNotificationType(type: string): string {
  switch (type) {
    case 'follow':
      return 'follow'
    case 'receiveFollowRequest':
      return 'follow_request'
    case 'mention':
    case 'reply':
      return 'mention'
    case 'renote':
    case 'quote':
      return 'reblog'
    case 'reaction':
      return 'reaction'
    case 'pollEnded':
    case 'pollVoted':
      return 'poll'
    case 'note':
      return 'status'
    case 'followRequestAccepted':
      return 'follow'
    case 'achievementEarned':
      return 'achievement'
    case 'app':
      return 'app'
    default:
      return type
  }
}

export function mapNotification(
  notif: Misskey.entities.Notification,
  instanceHost?: string,
): Entity.Notification {
  const base = {
    created_at: notif.createdAt,
    id: notif.id,
    type: mapNotificationType(notif.type),
  }

  // Handle different notification types
  if ('user' in notif && notif.user) {
    const account = mapUserLiteToAccount(
      notif.user as Misskey.entities.UserLite,
      instanceHost,
    )
    if ('note' in notif && notif.note) {
      const status = mapNoteToStatus(
        notif.note as Misskey.entities.Note,
        instanceHost,
      )
      if (notif.type === 'reaction' && 'reaction' in notif) {
        const rawReaction = (notif as { reaction: string }).reaction
        const reactionEmojis = (notif.note as Misskey.entities.Note | undefined)
          ?.reactionEmojis
        const r = normalizeReaction(rawReaction, reactionEmojis, instanceHost)
        return {
          ...base,
          account,
          reaction: {
            accounts: [],
            count: 1,
            me: false,
            name: r.name,
            ...(r.url ? { static_url: r.url, url: r.url } : {}),
          },
          status,
        }
      }
      return { ...base, account, status }
    }
    return { ...base, account }
  }

  // Notifications without user (scheduledNotePosted, achievementEarned, etc.)
  return { ...base, account: null }
}

// ========================================
// Utilities
// ========================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * MFM テキストを基本的な HTML に変換する。
 *
 * 対応する MFM 構文:
 * - URL のリンク化
 * - メンション (@user, @user@host) のリンク化
 * - ハッシュタグ (#tag) のリンク化
 * - **bold** → <strong>
 * - ~~strikethrough~~ → <del>
 * - `inline code` → <code>
 * - ```code block``` → <pre><code>
 * - <center> → text-align:center
 * - <small> → <small>
 * - 改行 → <br>
 */
function mfmToHtml(text: string, instanceHost?: string): string {
  const host = instanceHost ?? ''
  let escaped = escapeHtml(text)

  // 衝突を避けるためランダムな nonce をプレースホルダーに含める
  const nonce = Math.random().toString(36).slice(2, 10)

  // コードブロック（```lang\n...\n```）をプレースホルダーに退避
  // コード内の MFM 構文が変換されないよう保護する
  const codePlaceholders: string[] = []
  escaped = escaped.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, lang: string, code: string) => {
      const index = codePlaceholders.length
      const langAttr = lang ? ` class="language-${lang}"` : ''
      codePlaceholders.push(
        `<pre><code${langAttr}>${code.replace(/\n$/, '')}</code></pre>`,
      )
      return `\x00MFM_CODE_${nonce}_${index}\x00`
    },
  )

  // インラインコード（`code`）をプレースホルダーに退避
  escaped = escaped.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const index = codePlaceholders.length
    codePlaceholders.push(`<code>${code}</code>`)
    return `\x00MFM_CODE_${nonce}_${index}\x00`
  })

  // URL をプレースホルダーに置換して後続のメンション/ハッシュタグ変換から保護
  const urlPlaceholders: string[] = []
  escaped = escaped.replace(/https?:\/\/[^\s<>&)"']+/g, (url) => {
    const index = urlPlaceholders.length
    const safeUrlForHref = url.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    urlPlaceholders.push(
      `<a href="${safeUrlForHref}" rel="noopener noreferrer" target="_blank">${url}</a>`,
    )
    return `\x00MFM_URL_${nonce}_${index}\x00`
  })

  // MFM テキスト装飾
  // **bold** → <strong>
  escaped = escaped.replace(
    /\*\*(.+?)\*\*/g,
    (_match, content: string) => `<strong>${content}</strong>`,
  )

  // ~~strikethrough~~ → <del>
  escaped = escaped.replace(
    /~~(.+?)~~/g,
    (_match, content: string) => `<del>${content}</del>`,
  )

  // <center>text</center> → <div style="text-align:center">text</div>
  // escapeHtml により &lt;center&gt; に変換済み
  escaped = escaped.replace(
    /&lt;center&gt;([\s\S]*?)&lt;\/center&gt;/g,
    (_match, content: string) =>
      `<div style="text-align:center">${content}</div>`,
  )

  // <small>text</small> → <small>text</small>
  // escapeHtml により &lt;small&gt; に変換済み
  escaped = escaped.replace(
    /&lt;small&gt;([\s\S]*?)&lt;\/small&gt;/g,
    (_match, content: string) => `<small>${content}</small>`,
  )

  // メンションをリンク化 (@user@host or @user)
  escaped = escaped.replace(
    /(?<![\w.])@(\w[\w.-]*)(?:@([\w.-]+\.\w+))?/g,
    (_match, username: string, mentionHost?: string) => {
      const acct = mentionHost ? `${username}@${mentionHost}` : username
      const href = mentionHost
        ? `https://${mentionHost}/@${username}`
        : `${host}/@${username}`
      return `<a href="${href}" class="mention" rel="noopener noreferrer">@${acct}</a>`
    },
  )

  // ハッシュタグをリンク化 (#tag)
  escaped = escaped.replace(
    /(?<=^|[\s>])#(\w+)/g,
    (_match, tag: string) =>
      `<a href="${host}/tags/${tag}" class="hashtag" rel="noopener noreferrer">#${tag}</a>`,
  )

  // URL プレースホルダーを復元
  const placeholderRegex = new RegExp(`\x00MFM_URL_${nonce}_(\\d+)\x00`, 'g')
  escaped = escaped.replace(placeholderRegex, (match, index: string) => {
    const url = urlPlaceholders[Number(index)]
    // 未知のプレースホルダーはそのまま残す
    return url !== undefined ? url : match
  })

  // コードプレースホルダーを復元
  const codeRegex = new RegExp(`\x00MFM_CODE_${nonce}_(\\d+)\x00`, 'g')
  escaped = escaped.replace(codeRegex, (match, index: string) => {
    const code = codePlaceholders[Number(index)]
    return code !== undefined ? code : match
  })

  // 改行を <br> に変換
  escaped = escaped.replace(/\n/g, '<br>')

  return escaped
}

/**
 * MFM テキストからメンション情報を抽出する。
 */
function parseMentionsFromText(
  text: string,
  _mentionIds: string[],
  instanceHost?: string,
): Entity.Mention[] {
  const host = instanceHost ?? ''
  // URL 内のメンションを除外するため、URL を除去してからパース
  const textWithoutUrls = text.replace(/https?:\/\/[^\s)]+/g, '')
  const mentionRegex = /(?<![\w.])@(\w[\w.-]*)(?:@([\w.-]+\.\w+))?/g
  const mentions: Entity.Mention[] = []
  let match: RegExpExecArray | null

  // biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop pattern
  while ((match = mentionRegex.exec(textWithoutUrls)) !== null) {
    const username = match[1]
    const mentionHost = match[2]
    const acct = mentionHost ? `${username}@${mentionHost}` : username
    const url = mentionHost
      ? `https://${mentionHost}/@${username}`
      : `${host}/@${username}`
    // Misskey の note.mentions はテキスト内の出現順と対応しないため、
    // 安全に紐付けできる情報がない場合は id を空にしておく
    const id = ''
    mentions.push({ acct, id, url, username })
  }

  return mentions
}
