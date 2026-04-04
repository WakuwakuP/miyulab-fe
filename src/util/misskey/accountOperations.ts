import type { Entity, OAuth, Response } from 'megalodon'
import type * as Misskey from 'misskey-js'
import { createMiAuthAppData, fetchMiAuthToken } from './auth'
import {
  type MisskeyClientContext,
  NotImplementedError,
  wrapResponse,
} from './helpers'
import { mapUserDetailedToAccount, mapUserLiteToAccount } from './mappers'

// =============================================
// OAuth / App Registration
// =============================================

export function cancel(): void {
  // No-op: misskey-js doesn't have cancellation
}

export async function registerApp(
  ctx: MisskeyClientContext,
  clientName: string,
  options: Partial<{
    scopes: Array<string>
    redirect_uris: string
    website: string
  }>,
): Promise<OAuth.AppData> {
  const callbackUrl = options.redirect_uris ?? options.website ?? ''
  return createMiAuthAppData(ctx.origin, clientName, callbackUrl)
}

export async function createApp(
  ctx: MisskeyClientContext,
  clientName: string,
  options: Partial<{
    scopes: Array<string>
    redirect_uris: string
    website: string
  }>,
): Promise<OAuth.AppData> {
  return registerApp(ctx, clientName, options)
}

export async function fetchAccessToken(
  ctx: MisskeyClientContext,
  clientId: string | null,
  _clientSecret: string,
  _code: string,
  _redirectUri?: string,
): Promise<OAuth.TokenData> {
  // clientId is the MiAuth session ID
  const sessionId = clientId ?? ''
  return fetchMiAuthToken(ctx.origin, sessionId)
}

export async function refreshToken(
  _clientId: string,
  _clientSecret: string,
  _refreshToken: string,
): Promise<OAuth.TokenData> {
  throw new NotImplementedError('refreshToken')
}

export async function revokeToken(
  _clientId: string,
  _clientSecret: string,
  _token: string,
): Promise<Response<Record<string, never>>> {
  throw new NotImplementedError('revokeToken')
}

export async function verifyAppCredentials(): Promise<
  Response<Entity.Application>
> {
  return wrapResponse({
    name: 'Misskey',
  } as Entity.Application)
}

export async function registerAccount(
  _username: string,
  _email: string,
  _password: string,
  _agreement: boolean,
  _locale: string,
  _reason?: string | null,
): Promise<Response<Entity.Token>> {
  throw new NotImplementedError('registerAccount')
}

// =============================================
// Account
// =============================================

export async function verifyAccountCredentials(
  ctx: MisskeyClientContext,
): Promise<Response<Entity.Account>> {
  const me = await ctx.client.request('i', {})
  return wrapResponse(
    mapUserDetailedToAccount(
      me as unknown as Misskey.entities.UserDetailed,
      ctx.origin,
    ),
  )
}

export async function updateCredentials(
  _options?: Record<string, unknown>,
): Promise<Response<Entity.Account>> {
  throw new NotImplementedError('updateCredentials')
}

export async function getAccount(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Entity.Account>> {
  try {
    const user = await ctx.client.request('users/show', { userId: id })
    return wrapResponse(
      mapUserDetailedToAccount(
        user as unknown as Misskey.entities.UserDetailed,
        ctx.origin,
      ),
    )
  } catch (e) {
    // NO_SUCH_USER (404) の場合のみ username として検索をフォールバック
    const err = e as {
      status?: number
      statusCode?: number
      code?: string
      message?: string
    }
    const isNotFound =
      e instanceof Error &&
      (err.status === 404 ||
        err.statusCode === 404 ||
        err.code === 'NO_SUCH_USER' ||
        /NO_SUCH_USER|not found|404/i.test(e.message))
    if (!isNotFound) throw e

    try {
      const users = await ctx.client.request(
        'users/search-by-username-and-host',
        { limit: 1, username: id },
      )
      if (users.length > 0) {
        return wrapResponse(
          mapUserLiteToAccount(
            users[0] as unknown as Misskey.entities.UserLite,
            ctx.origin,
          ),
        )
      }
    } catch {
      // フォールバックも失敗した場合は元のエラーをスロー
    }
    throw e
  }
}

export async function getAccountStatuses(
  ctx: MisskeyClientContext,
  id: string,
  options?: {
    limit?: number
    max_id?: string
    since_id?: string
    min_id?: string
    pinned?: boolean
    exclude_replies?: boolean
    exclude_reblogs?: boolean
    only_media?: boolean
    only_public?: boolean
  },
): Promise<Response<Array<Entity.Status>>> {
  const notes = await ctx.client.request('users/notes', {
    limit: options?.limit ?? 20,
    userId: id,
    ...(options?.max_id ? { untilId: options.max_id } : {}),
    ...(options?.since_id ? { sinceId: options.since_id } : {}),
    ...(options?.only_media ? { withFiles: true } : {}),
    ...(options?.exclude_replies != null
      ? { withReplies: !options.exclude_replies }
      : {}),
    ...(options?.exclude_reblogs != null
      ? { withRenotes: !options.exclude_reblogs }
      : {}),
  })
  return wrapResponse(notes.map((n) => mapNoteToStatus(n, ctx.origin)))
}

export async function getAccountFavourites(
  _id: string,
  _options?: {
    limit?: number
    max_id?: string
    since_id?: string
  },
): Promise<Response<Array<Entity.Status>>> {
  throw new NotImplementedError('getAccountFavourites')
}

export async function subscribeAccount(
  _id: string,
): Promise<Response<Entity.Relationship>> {
  throw new NotImplementedError('subscribeAccount')
}

export async function unsubscribeAccount(
  _id: string,
): Promise<Response<Entity.Relationship>> {
  throw new NotImplementedError('unsubscribeAccount')
}

export async function getAccountFollowers(
  ctx: MisskeyClientContext,
  id: string,
  options?: {
    limit?: number
    max_id?: string
    since_id?: string
    get_all?: boolean
    sleep_ms?: number
  },
): Promise<Response<Array<Entity.Account>>> {
  const followers = await ctx.client.request('users/followers', {
    limit: options?.limit ?? 40,
    userId: id,
    ...(options?.max_id ? { untilId: options.max_id } : {}),
    ...(options?.since_id ? { sinceId: options.since_id } : {}),
  })
  return wrapResponse(
    followers.map((f: Record<string, unknown>) => {
      const follower = (f as { follower?: Misskey.entities.UserLite }).follower
      if (follower) {
        return mapUserLiteToAccount(follower, ctx.origin)
      }
      return mapUserLiteToAccount(
        f as unknown as Misskey.entities.UserLite,
        ctx.origin,
      )
    }),
  )
}

export async function getAccountFollowing(
  ctx: MisskeyClientContext,
  id: string,
  options?: {
    limit?: number
    max_id?: string
    since_id?: string
    get_all?: boolean
    sleep_ms?: number
  },
): Promise<Response<Array<Entity.Account>>> {
  const following = await ctx.client.request('users/following', {
    limit: options?.limit ?? 40,
    userId: id,
    ...(options?.max_id ? { untilId: options.max_id } : {}),
    ...(options?.since_id ? { sinceId: options.since_id } : {}),
  })
  return wrapResponse(
    following.map((f: Record<string, unknown>) => {
      const followee = (f as { followee?: Misskey.entities.UserLite }).followee
      if (followee) {
        return mapUserLiteToAccount(followee, ctx.origin)
      }
      return mapUserLiteToAccount(
        f as unknown as Misskey.entities.UserLite,
        ctx.origin,
      )
    }),
  )
}

export async function getAccountLists(
  _id: string,
): Promise<Response<Array<Entity.List>>> {
  throw new NotImplementedError('getAccountLists')
}

export async function getIdentityProof(
  _id: string,
): Promise<Response<Array<Entity.IdentityProof>>> {
  throw new NotImplementedError('getIdentityProof')
}

export async function followAccount(
  ctx: MisskeyClientContext,
  id: string,
  _options?: { reblog?: boolean },
): Promise<Response<Entity.Relationship>> {
  await ctx.client.request('following/create', { userId: id })
  return getRelationship(ctx, id)
}

export async function unfollowAccount(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Entity.Relationship>> {
  await ctx.client.request('following/delete', { userId: id })
  return getRelationship(ctx, id)
}

export async function blockAccount(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Entity.Relationship>> {
  await ctx.client.request('blocking/create', { userId: id })
  return getRelationship(ctx, id)
}

export async function unblockAccount(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Entity.Relationship>> {
  await ctx.client.request('blocking/delete', { userId: id })
  return getRelationship(ctx, id)
}

export async function muteAccount(
  ctx: MisskeyClientContext,
  id: string,
  _notifications: boolean,
): Promise<Response<Entity.Relationship>> {
  await ctx.client.request('mute/create', { userId: id })
  return getRelationship(ctx, id)
}

export async function unmuteAccount(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Entity.Relationship>> {
  await ctx.client.request('mute/delete', { userId: id })
  return getRelationship(ctx, id)
}

export async function pinAccount(
  _id: string,
): Promise<Response<Entity.Relationship>> {
  throw new NotImplementedError('pinAccount')
}

export async function unpinAccount(
  _id: string,
): Promise<Response<Entity.Relationship>> {
  throw new NotImplementedError('unpinAccount')
}

export async function setAccountNote(
  _id: string,
  _note?: string,
): Promise<Response<Entity.Relationship>> {
  throw new NotImplementedError('setAccountNote')
}

export async function getRelationship(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Entity.Relationship>> {
  const relation = await ctx.client.request('users/relation', {
    userId: id,
  })
  const rel = relation as unknown as {
    id: string
    isFollowing: boolean
    isFollowed: boolean
    hasPendingFollowRequestFromYou: boolean
    hasPendingFollowRequestToYou: boolean
    isBlocking: boolean
    isBlocked: boolean
    isMuted: boolean
  }
  return wrapResponse({
    blocked_by: rel.isBlocked ?? false,
    blocking: rel.isBlocking ?? false,
    domain_blocking: false,
    endorsed: false,
    followed_by: rel.isFollowed ?? false,
    following: rel.isFollowing ?? false,
    id: rel.id,
    muting: rel.isMuted ?? false,
    muting_notifications: false,
    note: null,
    notifying: false,
    requested: rel.hasPendingFollowRequestFromYou ?? false,
    showing_reblogs: true,
  } as unknown as Entity.Relationship)
}

export async function getRelationships(
  ctx: MisskeyClientContext,
  ids: Array<string>,
): Promise<Response<Array<Entity.Relationship>>> {
  const results = await Promise.all(
    ids.map(async (id) => {
      const res = await getRelationship(ctx, id)
      return res.data
    }),
  )
  return wrapResponse(results)
}

export async function searchAccount(
  ctx: MisskeyClientContext,
  q: string,
  options?: {
    following?: boolean
    resolve?: boolean
    limit?: number
    max_id?: string
    since_id?: string
  },
): Promise<Response<Array<Entity.Account>>> {
  // acct 形式 (user@host) の場合は users/search-by-username-and-host を使用
  const acctMatch = q.match(/^@?(\w[\w.-]*)@([\w.-]+\.\w+)$/)
  if (acctMatch) {
    const username = acctMatch[1]
    const host = acctMatch[2]
    const users = await ctx.client.request(
      'users/search-by-username-and-host',
      {
        host,
        limit: options?.limit ?? 20,
        username,
      },
    )
    return wrapResponse(
      users.map((u) =>
        mapUserLiteToAccount(
          u as unknown as Misskey.entities.UserLite,
          ctx.origin,
        ),
      ),
    )
  }

  const users = await ctx.client.request('users/search', {
    limit: options?.limit ?? 20,
    query: q,
  })
  return wrapResponse(
    users.map((u) =>
      mapUserLiteToAccount(
        u as unknown as Misskey.entities.UserLite,
        ctx.origin,
      ),
    ),
  )
}

export async function lookupAccount(
  ctx: MisskeyClientContext,
  acct: string,
): Promise<Response<Entity.Account>> {
  // Parse acct format: user@host or user
  const parts = acct.split('@')
  const username = parts[0]
  const host = parts.length > 1 ? parts[1] : null
  const users = await ctx.client.request('users/search-by-username-and-host', {
    username,
    ...(host ? { host } : {}),
    limit: 1,
  })
  if (users.length === 0) {
    throw new Error(`Account not found: ${acct}`)
  }
  return wrapResponse(
    mapUserLiteToAccount(
      users[0] as unknown as Misskey.entities.UserLite,
      ctx.origin,
    ),
  )
}

// =============================================
// Follow Requests
// =============================================

export async function getFollowRequests(
  ctx: MisskeyClientContext,
  _limit?: number,
): Promise<Response<Array<Entity.Account | Entity.FollowRequest>>> {
  const requests = await ctx.client.request('following/requests/list', {})
  return wrapResponse(
    requests.map((r: Record<string, unknown>) => {
      const follower = (r as { follower?: Misskey.entities.UserLite }).follower
      if (follower) {
        return mapUserLiteToAccount(follower, ctx.origin)
      }
      return mapUserLiteToAccount(
        r as unknown as Misskey.entities.UserLite,
        ctx.origin,
      )
    }),
  )
}

export async function acceptFollowRequest(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Entity.Relationship>> {
  await ctx.client.request('following/requests/accept', { userId: id })
  return getRelationship(ctx, id)
}

export async function rejectFollowRequest(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Entity.Relationship>> {
  await ctx.client.request('following/requests/reject', { userId: id })
  return getRelationship(ctx, id)
}

// Re-export mapNoteToStatus for use in getAccountStatuses
import { mapNoteToStatus } from './mappers'
