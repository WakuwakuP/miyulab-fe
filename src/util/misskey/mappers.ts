import type { Entity } from 'megalodon'
import type * as Misskey from 'misskey-js'

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
  return Object.entries(emojis).map(([shortcode, url]) => ({
    shortcode,
    static_url: url,
    url,
    visible_in_picker: true,
  }))
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
  // UserDetailed has additional fields
  const detailed = user as Misskey.entities.UserDetailed & {
    createdAt?: string
    description?: string | null
    followersCount?: number
    followingCount?: number
    notesCount?: number
    isLocked?: boolean
    fields?: Array<{ name: string; value: string }>
    bannerUrl?: string | null
  }

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

export function mapReactions(
  reactions: Record<string, number>,
  myReaction?: string | null,
  reactionEmojis?: Record<string, string>,
): Entity.Reaction[] {
  return Object.entries(reactions).map(([name, count]) => {
    // Custom emoji reactions have format :emoji_name: or :emoji_name@.:
    const isCustom = name.startsWith(':') && name.endsWith(':')
    const shortcode = isCustom ? name.slice(1, -1).replace(/@\.$/, '') : name
    const emojiUrl = reactionEmojis?.[shortcode] ?? null

    return {
      accounts: [],
      count,
      me: myReaction === name,
      name,
      // Only include static_url/url if it's a custom emoji with a known URL
      ...(emojiUrl ? { static_url: emojiUrl, url: emojiUrl } : {}),
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

  // Build content from text (basic MFM → HTML)
  const content = note.text ? escapeHtml(note.text) : ''

  return {
    account,
    application: null,
    bookmarked: false,
    card: null,
    content,
    created_at: note.createdAt,
    edited_at: null,
    emoji_reactions: mapReactions(
      note.reactions ?? {},
      note.myReaction,
      note.reactionEmojis,
    ),
    emojis: mapEmojis(note.emojis),
    favourited: note.myReaction != null ? true : null,
    favourites_count: note.reactionCount ?? 0,
    id: note.id,
    in_reply_to_account_id: null,
    in_reply_to_id: note.replyId ?? null,
    language: null,
    media_attachments: (note.files ?? []).map(mapDriveFileToAttachment),
    mentions: (note.mentions ?? []).map((id) => ({
      acct: '',
      id,
      url: '',
      username: '',
    })),
    muted: null,
    pinned: null,
    plain_content: note.text ?? null,
    poll: note.poll
      ? {
          expired: false,
          expires_at: note.poll.expiresAt ?? null,
          id: note.id,
          multiple: note.poll.multiple,
          options: note.poll.choices.map((c) => ({
            title: c.text,
            votes_count: c.votes,
          })),
          voted: note.poll.choices.some((c) => c.isVoted),
          votes_count: note.poll.choices.reduce((sum, c) => sum + c.votes, 0),
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
    reblogged: null,
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
      return 'favourite'
    case 'pollEnded':
      return 'poll'
    case 'note':
      return 'status'
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
        return {
          ...base,
          account,
          reaction: {
            accounts: [],
            count: 1,
            me: false,
            name: (notif as { reaction: string }).reaction,
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
    .replace(/\n/g, '<br>')
}
