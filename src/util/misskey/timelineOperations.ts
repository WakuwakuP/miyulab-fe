import type { Entity, Response } from 'megalodon'
import type * as Misskey from 'misskey-js'
import {
  type MisskeyClientContext,
  NotImplementedError,
  wrapResponse,
} from './helpers'
import { mapNoteToStatus, mapUserLiteToAccount } from './mappers'

// =============================================
// Timelines
// =============================================

export async function getPublicTimeline(
  ctx: MisskeyClientContext,
  options?: {
    only_media?: boolean
    limit?: number
    max_id?: string
    since_id?: string
    min_id?: string
  },
): Promise<Response<Array<Entity.Status>>> {
  const notes = await ctx.client.request('notes/global-timeline', {
    limit: options?.limit ?? 20,
    ...(options?.max_id ? { untilId: options.max_id } : {}),
    ...(options?.since_id ? { sinceId: options.since_id } : {}),
    ...(options?.only_media ? { withFiles: true } : {}),
  })
  return wrapResponse(notes.map((n) => mapNoteToStatus(n, ctx.origin)))
}

export async function getLocalTimeline(
  ctx: MisskeyClientContext,
  options?: {
    only_media?: boolean
    limit?: number
    max_id?: string
    since_id?: string
    min_id?: string
  },
): Promise<Response<Array<Entity.Status>>> {
  const notes = await ctx.client.request('notes/local-timeline', {
    limit: options?.limit ?? 20,
    ...(options?.max_id ? { untilId: options.max_id } : {}),
    ...(options?.since_id ? { sinceId: options.since_id } : {}),
    ...(options?.only_media ? { withFiles: true } : {}),
  })
  return wrapResponse(notes.map((n) => mapNoteToStatus(n, ctx.origin)))
}

export async function getTagTimeline(
  ctx: MisskeyClientContext,
  hashtag: string,
  options?: {
    local?: boolean
    only_media?: boolean
    limit?: number
    max_id?: string
    since_id?: string
    min_id?: string
  },
): Promise<Response<Array<Entity.Status>>> {
  const notes = await ctx.client.request('notes/search-by-tag', {
    limit: options?.limit ?? 20,
    tag: hashtag,
    ...(options?.max_id ? { untilId: options.max_id } : {}),
    ...(options?.since_id ? { sinceId: options.since_id } : {}),
  })
  return wrapResponse(notes.map((n) => mapNoteToStatus(n, ctx.origin)))
}

export async function getHomeTimeline(
  ctx: MisskeyClientContext,
  options?: {
    local?: boolean
    limit?: number
    max_id?: string
    since_id?: string
    min_id?: string
  },
): Promise<Response<Array<Entity.Status>>> {
  const notes = await ctx.client.request('notes/timeline', {
    limit: options?.limit ?? 20,
    ...(options?.max_id ? { untilId: options.max_id } : {}),
    ...(options?.since_id ? { sinceId: options.since_id } : {}),
  })
  return wrapResponse(notes.map((n) => mapNoteToStatus(n, ctx.origin)))
}

export async function getListTimeline(
  ctx: MisskeyClientContext,
  listId: string,
  options?: {
    limit?: number
    max_id?: string
    since_id?: string
    min_id?: string
  },
): Promise<Response<Array<Entity.Status>>> {
  const notes = await ctx.client.request('notes/user-list-timeline', {
    limit: options?.limit ?? 20,
    listId,
    ...(options?.max_id ? { untilId: options.max_id } : {}),
    ...(options?.since_id ? { sinceId: options.since_id } : {}),
  })
  return wrapResponse(notes.map((n) => mapNoteToStatus(n, ctx.origin)))
}

export async function getConversationTimeline(_options?: {
  limit?: number
  max_id?: string
  since_id?: string
  min_id?: string
}): Promise<Response<Array<Entity.Conversation>>> {
  throw new NotImplementedError('getConversationTimeline')
}

// =============================================
// Conversations
// =============================================

export async function deleteConversation(
  _id: string,
): Promise<Response<Record<string, never>>> {
  throw new NotImplementedError('deleteConversation')
}

export async function readConversation(
  _id: string,
): Promise<Response<Entity.Conversation>> {
  throw new NotImplementedError('readConversation')
}

// =============================================
// Lists
// =============================================

export async function getLists(
  ctx: MisskeyClientContext,
): Promise<Response<Array<Entity.List>>> {
  const lists = await ctx.client.request('users/lists/list', {})
  return wrapResponse(
    lists.map(
      (l) =>
        ({
          id: l.id,
          replies_policy: null,
          title: l.name,
        }) as unknown as Entity.List,
    ),
  )
}

export async function getList(_id: string): Promise<Response<Entity.List>> {
  throw new NotImplementedError('getList')
}

export async function createList(
  _title: string,
): Promise<Response<Entity.List>> {
  throw new NotImplementedError('createList')
}

export async function updateList(
  _id: string,
  _title: string,
): Promise<Response<Entity.List>> {
  throw new NotImplementedError('updateList')
}

export async function deleteList(
  _id: string,
): Promise<Response<Record<string, never>>> {
  throw new NotImplementedError('deleteList')
}

export async function getAccountsInList(
  _id: string,
  _options?: {
    limit?: number
    max_id?: string
    since_id?: string
  },
): Promise<Response<Array<Entity.Account>>> {
  throw new NotImplementedError('getAccountsInList')
}

export async function addAccountsToList(
  _id: string,
  _accountIds: Array<string>,
): Promise<Response<Record<string, never>>> {
  throw new NotImplementedError('addAccountsToList')
}

export async function deleteAccountsFromList(
  _id: string,
  _accountIds: Array<string>,
): Promise<Response<Record<string, never>>> {
  throw new NotImplementedError('deleteAccountsFromList')
}

// =============================================
// Markers
// =============================================

export async function getMarkers(
  _timeline: Array<string>,
): Promise<Response<Entity.Marker | Record<string, never>>> {
  return wrapResponse({})
}

export async function saveMarkers(_options?: {
  home?: { last_read_id: string }
  notifications?: { last_read_id: string }
}): Promise<Response<Entity.Marker>> {
  throw new NotImplementedError('saveMarkers')
}

// =============================================
// Search
// =============================================

export async function search(
  ctx: MisskeyClientContext,
  q: string,
  options?: {
    type?: 'accounts' | 'hashtags' | 'statuses'
    limit?: number
    max_id?: string
    min_id?: string
    resolve?: boolean
    offset?: number
    following?: boolean
    account_id?: string
    exclude_unreviewed?: boolean
  },
): Promise<Response<Entity.Results>> {
  const results: Entity.Results = {
    accounts: [],
    hashtags: [],
    statuses: [],
  }

  if (!options?.type || options.type === 'accounts') {
    const users = await ctx.client.request('users/search', {
      limit: options?.limit ?? 20,
      query: q,
    })
    results.accounts = users.map((u) =>
      mapUserLiteToAccount(
        u as unknown as Misskey.entities.UserLite,
        ctx.origin,
      ),
    )
  }

  if (!options?.type || options.type === 'statuses') {
    const notes = await ctx.client.request('notes/search', {
      limit: options?.limit ?? 20,
      query: q,
    })
    results.statuses = notes.map((n) => mapNoteToStatus(n, ctx.origin))
  }

  if (!options?.type || options.type === 'hashtags') {
    // Misskey doesn't have a dedicated hashtag search API
    // Return empty for now
    results.hashtags = []
  }

  return wrapResponse(results)
}
