import type { Entity, Response } from 'megalodon'
import type * as Misskey from 'misskey-js'
import {
  type MisskeyClientContext,
  NotImplementedError,
  wrapResponse,
} from './helpers'
import {
  mapDriveFileToAttachment,
  mapNoteToStatus,
  mapUserLiteToAccount,
  mapVisibilityToMisskey,
} from './mappers'

// =============================================
// Statuses
// =============================================

export async function postStatus(
  ctx: MisskeyClientContext,
  status: string,
  options?: {
    media_ids?: Array<string>
    poll?: {
      options: Array<string>
      expires_in: number
      multiple?: boolean
      hide_totals?: boolean
    }
    in_reply_to_id?: string
    sensitive?: boolean
    spoiler_text?: string
    visibility?: Entity.StatusVisibility
    scheduled_at?: string
    language?: string
    quote_id?: string
  },
): Promise<Response<Entity.Status | Entity.ScheduledStatus>> {
  const params: Record<string, unknown> = {
    text: status,
  }

  if (options?.visibility) {
    params.visibility = mapVisibilityToMisskey(options.visibility)
  }

  if (options?.in_reply_to_id) {
    params.replyId = options.in_reply_to_id
  }

  if (options?.spoiler_text) {
    params.cw = options.spoiler_text
  }

  if (options?.media_ids && options.media_ids.length > 0) {
    params.fileIds = options.media_ids
  }

  if (options?.quote_id) {
    params.renoteId = options.quote_id
  }

  if (options?.poll) {
    params.poll = {
      choices: options.poll.options,
      expiredAfter: options.poll.expires_in * 1000,
      multiple: options.poll.multiple ?? false,
    }
  }

  // biome-ignore lint/complexity/noBannedTypes: misskey-js の notes/create は動的パラメータのため型安全な呼び出しが困難
  const note = await (ctx.client.request as Function)('notes/create', params)
  const createdNote = (note as { createdNote: Misskey.entities.Note })
    .createdNote
  return wrapResponse(mapNoteToStatus(createdNote, ctx.origin))
}

export async function getStatus(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Entity.Status>> {
  const note = await ctx.client.request('notes/show', { noteId: id })
  return wrapResponse(mapNoteToStatus(note, ctx.origin))
}

export async function editStatus(
  _id: string,
  _options: {
    status?: string
    spoiler_text?: string
    sensitive?: boolean
    media_ids?: Array<string>
    poll?: {
      options?: Array<string>
      expires_in?: number
      multiple?: boolean
      hide_totals?: boolean
    }
  },
): Promise<Response<Entity.Status>> {
  throw new NotImplementedError('editStatus')
}

export async function deleteStatus(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Record<string, never>>> {
  await ctx.client.request('notes/delete', { noteId: id })
  return wrapResponse({} as Record<string, never>)
}

export async function getStatusContext(
  ctx: MisskeyClientContext,
  id: string,
  _options?: {
    limit?: number
    max_id?: string
    since_id?: string
  },
): Promise<Response<Entity.Context>> {
  const emptyContext: Entity.Context = { ancestors: [], descendants: [] }

  // notes/conversation はリモートノートで失敗する場合があるため個別に try-catch
  let ancestors: Entity.Status[] = []
  try {
    const conversation = await ctx.client.request('notes/conversation', {
      limit: 40,
      noteId: id,
    })
    ancestors = conversation
      .reverse()
      .map((n) => mapNoteToStatus(n, ctx.origin))
  } catch (e) {
    console.warn('Failed to fetch notes/conversation:', e)
  }

  let descendants: Entity.Status[] = []
  try {
    const children = await ctx.client.request('notes/children', {
      limit: 40,
      noteId: id,
    })
    descendants = children.map((n) => mapNoteToStatus(n, ctx.origin))
  } catch (e) {
    console.warn('Failed to fetch notes/children:', e)
    // ancestors も descendants も取得できない場合は空コンテキストを返す
    if (ancestors.length === 0) {
      return wrapResponse(emptyContext)
    }
  }

  return wrapResponse({ ancestors, descendants })
}

export async function getStatusSource(
  _id: string,
): Promise<Response<Entity.StatusSource>> {
  throw new NotImplementedError('getStatusSource')
}

export async function getStatusRebloggedBy(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Array<Entity.Account>>> {
  const renotes = await ctx.client.request('notes/renotes', {
    limit: 40,
    noteId: id,
  })
  return wrapResponse(
    renotes.map((n) => mapUserLiteToAccount(n.user, ctx.origin)),
  )
}

export async function getStatusFavouritedBy(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Array<Entity.Account>>> {
  const reactions = await ctx.client.request('notes/reactions', {
    limit: 40,
    noteId: id,
  })
  return wrapResponse(
    reactions.map((r: Record<string, unknown>) => {
      const user = (r as { user: Misskey.entities.UserLite }).user
      return mapUserLiteToAccount(user, ctx.origin)
    }),
  )
}

export async function favouriteStatus(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Entity.Status>> {
  // Misskey uses reactions instead of favourites; use ❤️ as default
  await ctx.client.request('notes/reactions/create', {
    noteId: id,
    reaction: '❤️',
  })
  return getStatus(ctx, id)
}

export async function unfavouriteStatus(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Entity.Status>> {
  await ctx.client.request('notes/reactions/delete', { noteId: id })
  return getStatus(ctx, id)
}

export async function reblogStatus(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Entity.Status>> {
  // biome-ignore lint/complexity/noBannedTypes: misskey-js の notes/create は動的パラメータのため型安全な呼び出しが困難
  const result = await (ctx.client.request as Function)('notes/create', {
    renoteId: id,
  })
  const createdNote = (result as { createdNote: Misskey.entities.Note })
    .createdNote
  return wrapResponse(mapNoteToStatus(createdNote, ctx.origin))
}

export async function unreblogStatus(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Entity.Status>> {
  // Misskey: delete the renote by unrenoteing
  await ctx.client.request('notes/unrenote', { noteId: id })
  return getStatus(ctx, id)
}

export async function bookmarkStatus(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Entity.Status>> {
  await ctx.client.request('notes/favorites/create', { noteId: id })
  const status = await getStatus(ctx, id)
  status.data.bookmarked = true
  return status
}

export async function unbookmarkStatus(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Entity.Status>> {
  await ctx.client.request('notes/favorites/delete', { noteId: id })
  const status = await getStatus(ctx, id)
  status.data.bookmarked = false
  return status
}

export async function muteStatus(
  _id: string,
): Promise<Response<Entity.Status>> {
  throw new NotImplementedError('muteStatus')
}

export async function unmuteStatus(
  _id: string,
): Promise<Response<Entity.Status>> {
  throw new NotImplementedError('unmuteStatus')
}

export async function pinStatus(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Entity.Status>> {
  await ctx.client.request('i/pin', { noteId: id })
  return getStatus(ctx, id)
}

export async function unpinStatus(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Entity.Status>> {
  await ctx.client.request('i/unpin', { noteId: id })
  return getStatus(ctx, id)
}

// =============================================
// Media
// =============================================

export async function uploadMedia(
  ctx: MisskeyClientContext,
  file: unknown,
  options?: {
    description?: string
    focus?: string
  },
): Promise<Response<Entity.Attachment | Entity.AsyncAttachment>> {
  const params: Record<string, unknown> = {
    file: file as Blob,
  }
  if (options?.description) {
    params.comment = options.description
  }
  // biome-ignore lint/complexity/noBannedTypes: misskey-js の drive/files/create は multipart/form-data のため型安全な呼び出しが困難
  const driveFile = await (ctx.client.request as Function)(
    'drive/files/create',
    params,
  )
  return wrapResponse(
    mapDriveFileToAttachment(driveFile as Misskey.entities.DriveFile),
  )
}

export async function getMedia(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Entity.Attachment>> {
  const driveFile = await ctx.client.request('drive/files/show', {
    fileId: id,
  })
  return wrapResponse(mapDriveFileToAttachment(driveFile))
}

export async function updateMedia(
  ctx: MisskeyClientContext,
  id: string,
  options?: {
    file?: unknown
    description?: string
    focus?: string
    is_sensitive?: boolean
  },
): Promise<Response<Entity.Attachment>> {
  const params: Record<string, unknown> = {
    fileId: id,
  }
  if (options?.description !== undefined) {
    params.comment = options.description
  }
  if (options?.is_sensitive !== undefined) {
    params.isSensitive = options.is_sensitive
  }
  const driveFile = await ctx.client.request(
    'drive/files/update',
    params as Misskey.entities.DriveFilesUpdateRequest,
  )
  return wrapResponse(mapDriveFileToAttachment(driveFile))
}

// =============================================
// Polls
// =============================================

export async function getPoll(_id: string): Promise<Response<Entity.Poll>> {
  throw new NotImplementedError('getPoll')
}

export async function votePoll(
  _id: string,
  _choices: Array<number>,
  _status_id?: string | null,
): Promise<Response<Entity.Poll>> {
  throw new NotImplementedError('votePoll')
}

// =============================================
// Scheduled Statuses
// =============================================

export async function getScheduledStatuses(_options?: {
  limit?: number
  max_id?: string
  since_id?: string
  min_id?: string
}): Promise<Response<Array<Entity.ScheduledStatus>>> {
  return wrapResponse([])
}

export async function getScheduledStatus(
  _id: string,
): Promise<Response<Entity.ScheduledStatus>> {
  throw new NotImplementedError('getScheduledStatus')
}

export async function scheduleStatus(
  _id: string,
  _scheduledAt?: string | null,
): Promise<Response<Entity.ScheduledStatus>> {
  throw new NotImplementedError('scheduleStatus')
}

export async function cancelScheduledStatus(
  _id: string,
): Promise<Response<Record<string, never>>> {
  throw new NotImplementedError('cancelScheduledStatus')
}

// =============================================
// Emoji Reactions
// =============================================

export async function createEmojiReaction(
  ctx: MisskeyClientContext,
  id: string,
  emoji: string,
): Promise<Response<Entity.Status>> {
  await ctx.client.request('notes/reactions/create', {
    noteId: id,
    reaction: emoji,
  })
  return getStatus(ctx, id)
}

export async function deleteEmojiReaction(
  ctx: MisskeyClientContext,
  id: string,
  _emoji: string,
): Promise<Response<Entity.Status>> {
  await ctx.client.request('notes/reactions/delete', { noteId: id })
  return getStatus(ctx, id)
}

export async function getEmojiReactions(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Array<Entity.Reaction>>> {
  const note = await ctx.client.request('notes/show', { noteId: id })
  const reactions: Record<string, number> = note.reactions ?? {}
  return wrapResponse(
    Object.entries(reactions).map(
      ([name, count]: [string, number]) =>
        ({
          accounts: [],
          count,
          me: note.myReaction === name,
          name,
        }) as Entity.Reaction,
    ),
  )
}

export async function getEmojiReaction(
  ctx: MisskeyClientContext,
  id: string,
  emoji: string,
): Promise<Response<Entity.Reaction>> {
  const res = await getEmojiReactions(ctx, id)
  const found = res.data.find((r) => r.name === emoji)
  if (!found) {
    return wrapResponse({
      accounts: [],
      count: 0,
      me: false,
      name: emoji,
    } as Entity.Reaction)
  }
  return wrapResponse(found)
}
