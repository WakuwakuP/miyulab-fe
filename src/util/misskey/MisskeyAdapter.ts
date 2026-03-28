import type {
  Entity,
  MegalodonInterface,
  OAuth,
  Response,
  WebSocketInterface,
} from 'megalodon'
import * as Misskey from 'misskey-js'
import { createMiAuthAppData, fetchMiAuthToken } from './auth'
import { MisskeyWebSocketAdapter } from './MisskeyWebSocketAdapter'
import {
  ensureAbsoluteUrl,
  mapNoteToStatus,
  mapNotification,
  mapUserDetailedToAccount,
  mapUserLiteToAccount,
  mapVisibilityToMisskey,
} from './mappers'

// ========================================
// Helper: megalodon Response wrapper
// ========================================

function wrapResponse<T>(data: T, status = 200): Response<T> {
  return {
    data,
    headers: {},
    status,
    statusText: 'OK',
  }
}

class NotImplementedError extends Error {
  constructor(method: string) {
    super(`MisskeyAdapter: ${method} is not implemented`)
    this.name = 'NotImplementedError'
  }
}

// ========================================
// MisskeyAdapter
// ========================================

export class MisskeyAdapter implements MegalodonInterface {
  private client: Misskey.api.APIClient
  private origin: string
  private credential: string | null

  constructor(origin: string, credential?: string | null) {
    this.origin = origin
    this.credential = credential ?? null
    this.client = new Misskey.api.APIClient({
      credential: credential ?? undefined,
      origin,
    })
  }

  // =============================================
  // OAuth / App Registration
  // =============================================

  cancel(): void {
    // No-op: misskey-js doesn't have cancellation
  }

  async registerApp(
    clientName: string,
    options: Partial<{
      scopes: Array<string>
      redirect_uris: string
      website: string
    }>,
  ): Promise<OAuth.AppData> {
    const callbackUrl = options.redirect_uris ?? options.website ?? ''
    return createMiAuthAppData(this.origin, clientName, callbackUrl)
  }

  async createApp(
    clientName: string,
    options: Partial<{
      scopes: Array<string>
      redirect_uris: string
      website: string
    }>,
  ): Promise<OAuth.AppData> {
    return this.registerApp(clientName, options)
  }

  async fetchAccessToken(
    clientId: string | null,
    _clientSecret: string,
    _code: string,
    _redirectUri?: string,
  ): Promise<OAuth.TokenData> {
    // clientId is the MiAuth session ID
    const sessionId = clientId ?? ''
    return fetchMiAuthToken(this.origin, sessionId)
  }

  async refreshToken(
    _clientId: string,
    _clientSecret: string,
    _refreshToken: string,
  ): Promise<OAuth.TokenData> {
    throw new NotImplementedError('refreshToken')
  }

  async revokeToken(
    _clientId: string,
    _clientSecret: string,
    _token: string,
  ): Promise<Response<Record<string, never>>> {
    throw new NotImplementedError('revokeToken')
  }

  async verifyAppCredentials(): Promise<Response<Entity.Application>> {
    return wrapResponse({
      name: 'Misskey',
    } as Entity.Application)
  }

  async registerAccount(
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

  async verifyAccountCredentials(): Promise<Response<Entity.Account>> {
    const me = await this.client.request('i', {})
    return wrapResponse(
      mapUserDetailedToAccount(
        me as unknown as Misskey.entities.UserDetailed,
        this.origin,
      ),
    )
  }

  async updateCredentials(
    _options?: Record<string, unknown>,
  ): Promise<Response<Entity.Account>> {
    throw new NotImplementedError('updateCredentials')
  }

  async getAccount(id: string): Promise<Response<Entity.Account>> {
    try {
      const user = await this.client.request('users/show', { userId: id })
      return wrapResponse(
        mapUserDetailedToAccount(
          user as unknown as Misskey.entities.UserDetailed,
          this.origin,
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
        const users = await this.client.request(
          'users/search-by-username-and-host',
          { limit: 1, username: id },
        )
        if (users.length > 0) {
          return wrapResponse(
            mapUserLiteToAccount(
              users[0] as unknown as Misskey.entities.UserLite,
              this.origin,
            ),
          )
        }
      } catch {
        // フォールバックも失敗した場合は元のエラーをスロー
      }
      throw e
    }
  }

  async getAccountStatuses(
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
    const notes = await this.client.request('users/notes', {
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
    return wrapResponse(notes.map((n) => mapNoteToStatus(n, this.origin)))
  }

  async getAccountFavourites(
    _id: string,
    _options?: {
      limit?: number
      max_id?: string
      since_id?: string
    },
  ): Promise<Response<Array<Entity.Status>>> {
    throw new NotImplementedError('getAccountFavourites')
  }

  async subscribeAccount(_id: string): Promise<Response<Entity.Relationship>> {
    throw new NotImplementedError('subscribeAccount')
  }

  async unsubscribeAccount(
    _id: string,
  ): Promise<Response<Entity.Relationship>> {
    throw new NotImplementedError('unsubscribeAccount')
  }

  async getAccountFollowers(
    id: string,
    options?: {
      limit?: number
      max_id?: string
      since_id?: string
      get_all?: boolean
      sleep_ms?: number
    },
  ): Promise<Response<Array<Entity.Account>>> {
    const followers = await this.client.request('users/followers', {
      limit: options?.limit ?? 40,
      userId: id,
      ...(options?.max_id ? { untilId: options.max_id } : {}),
      ...(options?.since_id ? { sinceId: options.since_id } : {}),
    })
    return wrapResponse(
      followers.map((f: Record<string, unknown>) => {
        const follower = (f as { follower?: Misskey.entities.UserLite })
          .follower
        if (follower) {
          return mapUserLiteToAccount(follower, this.origin)
        }
        return mapUserLiteToAccount(
          f as unknown as Misskey.entities.UserLite,
          this.origin,
        )
      }),
    )
  }

  async getAccountFollowing(
    id: string,
    options?: {
      limit?: number
      max_id?: string
      since_id?: string
      get_all?: boolean
      sleep_ms?: number
    },
  ): Promise<Response<Array<Entity.Account>>> {
    const following = await this.client.request('users/following', {
      limit: options?.limit ?? 40,
      userId: id,
      ...(options?.max_id ? { untilId: options.max_id } : {}),
      ...(options?.since_id ? { sinceId: options.since_id } : {}),
    })
    return wrapResponse(
      following.map((f: Record<string, unknown>) => {
        const followee = (f as { followee?: Misskey.entities.UserLite })
          .followee
        if (followee) {
          return mapUserLiteToAccount(followee, this.origin)
        }
        return mapUserLiteToAccount(
          f as unknown as Misskey.entities.UserLite,
          this.origin,
        )
      }),
    )
  }

  async getAccountLists(_id: string): Promise<Response<Array<Entity.List>>> {
    throw new NotImplementedError('getAccountLists')
  }

  async getIdentityProof(
    _id: string,
  ): Promise<Response<Array<Entity.IdentityProof>>> {
    throw new NotImplementedError('getIdentityProof')
  }

  async followAccount(
    id: string,
    _options?: { reblog?: boolean },
  ): Promise<Response<Entity.Relationship>> {
    await this.client.request('following/create', { userId: id })
    return this.getRelationship(id)
  }

  async unfollowAccount(id: string): Promise<Response<Entity.Relationship>> {
    await this.client.request('following/delete', { userId: id })
    return this.getRelationship(id)
  }

  async blockAccount(id: string): Promise<Response<Entity.Relationship>> {
    await this.client.request('blocking/create', { userId: id })
    return this.getRelationship(id)
  }

  async unblockAccount(id: string): Promise<Response<Entity.Relationship>> {
    await this.client.request('blocking/delete', { userId: id })
    return this.getRelationship(id)
  }

  async muteAccount(
    id: string,
    _notifications: boolean,
  ): Promise<Response<Entity.Relationship>> {
    await this.client.request('mute/create', { userId: id })
    return this.getRelationship(id)
  }

  async unmuteAccount(id: string): Promise<Response<Entity.Relationship>> {
    await this.client.request('mute/delete', { userId: id })
    return this.getRelationship(id)
  }

  async pinAccount(_id: string): Promise<Response<Entity.Relationship>> {
    throw new NotImplementedError('pinAccount')
  }

  async unpinAccount(_id: string): Promise<Response<Entity.Relationship>> {
    throw new NotImplementedError('unpinAccount')
  }

  async setAccountNote(
    _id: string,
    _note?: string,
  ): Promise<Response<Entity.Relationship>> {
    throw new NotImplementedError('setAccountNote')
  }

  async getRelationship(id: string): Promise<Response<Entity.Relationship>> {
    const relation = await this.client.request('users/relation', {
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

  async getRelationships(
    ids: Array<string>,
  ): Promise<Response<Array<Entity.Relationship>>> {
    const results = await Promise.all(
      ids.map(async (id) => {
        const res = await this.getRelationship(id)
        return res.data
      }),
    )
    return wrapResponse(results)
  }

  async searchAccount(
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
      const users = await this.client.request(
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
            this.origin,
          ),
        ),
      )
    }

    const users = await this.client.request('users/search', {
      limit: options?.limit ?? 20,
      query: q,
    })
    return wrapResponse(
      users.map((u) =>
        mapUserLiteToAccount(
          u as unknown as Misskey.entities.UserLite,
          this.origin,
        ),
      ),
    )
  }

  async lookupAccount(acct: string): Promise<Response<Entity.Account>> {
    // Parse acct format: user@host or user
    const parts = acct.split('@')
    const username = parts[0]
    const host = parts.length > 1 ? parts[1] : null
    const users = await this.client.request(
      'users/search-by-username-and-host',
      {
        username,
        ...(host ? { host } : {}),
        limit: 1,
      },
    )
    if (users.length === 0) {
      throw new Error(`Account not found: ${acct}`)
    }
    return wrapResponse(
      mapUserLiteToAccount(
        users[0] as unknown as Misskey.entities.UserLite,
        this.origin,
      ),
    )
  }

  // =============================================
  // Bookmarks / Favourites / Mutes / Blocks
  // =============================================

  async getBookmarks(_options?: {
    limit?: number
    max_id?: string
    since_id?: string
    min_id?: string
  }): Promise<Response<Array<Entity.Status>>> {
    throw new NotImplementedError('getBookmarks')
  }

  async getFavourites(_options?: {
    limit?: number
    max_id?: string
    min_id?: string
  }): Promise<Response<Array<Entity.Status>>> {
    throw new NotImplementedError('getFavourites')
  }

  async getMutes(_options?: {
    limit?: number
    max_id?: string
    min_id?: string
  }): Promise<Response<Array<Entity.Account>>> {
    throw new NotImplementedError('getMutes')
  }

  async getBlocks(_options?: {
    limit?: number
    max_id?: string
    min_id?: string
  }): Promise<Response<Array<Entity.Account>>> {
    throw new NotImplementedError('getBlocks')
  }

  async getDomainBlocks(_options?: {
    limit?: number
    max_id?: string
    min_id?: string
  }): Promise<Response<Array<string>>> {
    throw new NotImplementedError('getDomainBlocks')
  }

  async blockDomain(_domain: string): Promise<Response<Record<string, never>>> {
    throw new NotImplementedError('blockDomain')
  }

  async unblockDomain(
    _domain: string,
  ): Promise<Response<Record<string, never>>> {
    throw new NotImplementedError('unblockDomain')
  }

  // =============================================
  // Filters
  // =============================================

  async getFilters(): Promise<Response<Array<Entity.Filter>>> {
    return wrapResponse([])
  }

  async getFilter(_id: string): Promise<Response<Entity.Filter>> {
    throw new NotImplementedError('getFilter')
  }

  async createFilter(
    _phrase: string,
    _context: Array<Entity.FilterContext>,
    _options?: {
      irreversible?: boolean
      whole_word?: boolean
      expires_in?: string
    },
  ): Promise<Response<Entity.Filter>> {
    throw new NotImplementedError('createFilter')
  }

  async updateFilter(
    _id: string,
    _phrase: string,
    _context: Array<Entity.FilterContext>,
    _options?: {
      irreversible?: boolean
      whole_word?: boolean
      expires_in?: string
    },
  ): Promise<Response<Entity.Filter>> {
    throw new NotImplementedError('updateFilter')
  }

  async deleteFilter(_id: string): Promise<Response<Entity.Filter>> {
    throw new NotImplementedError('deleteFilter')
  }

  // =============================================
  // Reports
  // =============================================

  async report(
    _accountId: string,
    _options?: {
      status_ids?: Array<string>
      comment: string
      forward?: boolean
      category?: Entity.Category
      rule_ids?: Array<number>
    },
  ): Promise<Response<Entity.Report>> {
    throw new NotImplementedError('report')
  }

  // =============================================
  // Follow Requests
  // =============================================

  async getFollowRequests(
    _limit?: number,
  ): Promise<Response<Array<Entity.Account | Entity.FollowRequest>>> {
    const requests = await this.client.request('following/requests/list', {})
    return wrapResponse(
      requests.map((r: Record<string, unknown>) => {
        const follower = (r as { follower?: Misskey.entities.UserLite })
          .follower
        if (follower) {
          return mapUserLiteToAccount(follower, this.origin)
        }
        return mapUserLiteToAccount(
          r as unknown as Misskey.entities.UserLite,
          this.origin,
        )
      }),
    )
  }

  async acceptFollowRequest(
    id: string,
  ): Promise<Response<Entity.Relationship>> {
    await this.client.request('following/requests/accept', { userId: id })
    return this.getRelationship(id)
  }

  async rejectFollowRequest(
    id: string,
  ): Promise<Response<Entity.Relationship>> {
    await this.client.request('following/requests/reject', { userId: id })
    return this.getRelationship(id)
  }

  // =============================================
  // Endorsements / Featured Tags / Suggestions
  // =============================================

  async getEndorsements(_options?: {
    limit?: number
    max_id?: string
    since_id?: string
  }): Promise<Response<Array<Entity.Account>>> {
    return wrapResponse([])
  }

  async getFeaturedTags(): Promise<Response<Array<Entity.FeaturedTag>>> {
    return wrapResponse([])
  }

  async createFeaturedTag(
    _name: string,
  ): Promise<Response<Entity.FeaturedTag>> {
    throw new NotImplementedError('createFeaturedTag')
  }

  async deleteFeaturedTag(
    _id: string,
  ): Promise<Response<Record<string, never>>> {
    throw new NotImplementedError('deleteFeaturedTag')
  }

  async getSuggestedTags(): Promise<Response<Array<Entity.Tag>>> {
    return wrapResponse([])
  }

  async getPreferences(): Promise<Response<Entity.Preferences>> {
    throw new NotImplementedError('getPreferences')
  }

  async getFollowedTags(): Promise<Response<Array<Entity.Tag>>> {
    return wrapResponse([])
  }

  async getSuggestions(
    _limit?: number,
  ): Promise<Response<Array<Entity.Account>>> {
    return wrapResponse([])
  }

  async getTag(_id: string): Promise<Response<Entity.Tag>> {
    throw new NotImplementedError('getTag')
  }

  async followTag(_id: string): Promise<Response<Entity.Tag>> {
    throw new NotImplementedError('followTag')
  }

  async unfollowTag(_id: string): Promise<Response<Entity.Tag>> {
    throw new NotImplementedError('unfollowTag')
  }

  // =============================================
  // Statuses
  // =============================================

  async postStatus(
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
    const note = await (this.client.request as Function)('notes/create', params)
    const createdNote = (note as { createdNote: Misskey.entities.Note })
      .createdNote
    return wrapResponse(mapNoteToStatus(createdNote, this.origin))
  }

  async getStatus(id: string): Promise<Response<Entity.Status>> {
    const note = await this.client.request('notes/show', { noteId: id })
    return wrapResponse(mapNoteToStatus(note, this.origin))
  }

  async editStatus(
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

  async deleteStatus(id: string): Promise<Response<Record<string, never>>> {
    await this.client.request('notes/delete', { noteId: id })
    return wrapResponse({} as Record<string, never>)
  }

  async getStatusContext(
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
      const conversation = await this.client.request('notes/conversation', {
        limit: 40,
        noteId: id,
      })
      ancestors = conversation
        .reverse()
        .map((n) => mapNoteToStatus(n, this.origin))
    } catch (e) {
      console.warn('Failed to fetch notes/conversation:', e)
    }

    let descendants: Entity.Status[] = []
    try {
      const children = await this.client.request('notes/children', {
        limit: 40,
        noteId: id,
      })
      descendants = children.map((n) => mapNoteToStatus(n, this.origin))
    } catch (e) {
      console.warn('Failed to fetch notes/children:', e)
      // ancestors も descendants も取得できない場合は空コンテキストを返す
      if (ancestors.length === 0) {
        return wrapResponse(emptyContext)
      }
    }

    return wrapResponse({ ancestors, descendants })
  }

  async getStatusSource(_id: string): Promise<Response<Entity.StatusSource>> {
    throw new NotImplementedError('getStatusSource')
  }

  async getStatusRebloggedBy(
    id: string,
  ): Promise<Response<Array<Entity.Account>>> {
    const renotes = await this.client.request('notes/renotes', {
      limit: 40,
      noteId: id,
    })
    return wrapResponse(
      renotes.map((n) => mapUserLiteToAccount(n.user, this.origin)),
    )
  }

  async getStatusFavouritedBy(
    id: string,
  ): Promise<Response<Array<Entity.Account>>> {
    const reactions = await this.client.request('notes/reactions', {
      limit: 40,
      noteId: id,
    })
    return wrapResponse(
      reactions.map((r: Record<string, unknown>) => {
        const user = (r as { user: Misskey.entities.UserLite }).user
        return mapUserLiteToAccount(user, this.origin)
      }),
    )
  }

  async favouriteStatus(id: string): Promise<Response<Entity.Status>> {
    // Misskey uses reactions instead of favourites; use ❤️ as default
    await this.client.request('notes/reactions/create', {
      noteId: id,
      reaction: '❤️',
    })
    return this.getStatus(id)
  }

  async unfavouriteStatus(id: string): Promise<Response<Entity.Status>> {
    await this.client.request('notes/reactions/delete', { noteId: id })
    return this.getStatus(id)
  }

  async reblogStatus(id: string): Promise<Response<Entity.Status>> {
    // biome-ignore lint/complexity/noBannedTypes: misskey-js の notes/create は動的パラメータのため型安全な呼び出しが困難
    const result = await (this.client.request as Function)('notes/create', {
      renoteId: id,
    })
    const createdNote = (result as { createdNote: Misskey.entities.Note })
      .createdNote
    return wrapResponse(mapNoteToStatus(createdNote, this.origin))
  }

  async unreblogStatus(id: string): Promise<Response<Entity.Status>> {
    // Misskey: delete the renote by unrenoteing
    await this.client.request('notes/unrenote', { noteId: id })
    return this.getStatus(id)
  }

  async bookmarkStatus(id: string): Promise<Response<Entity.Status>> {
    await this.client.request('notes/favorites/create', { noteId: id })
    const status = await this.getStatus(id)
    status.data.bookmarked = true
    return status
  }

  async unbookmarkStatus(id: string): Promise<Response<Entity.Status>> {
    await this.client.request('notes/favorites/delete', { noteId: id })
    const status = await this.getStatus(id)
    status.data.bookmarked = false
    return status
  }

  async muteStatus(_id: string): Promise<Response<Entity.Status>> {
    throw new NotImplementedError('muteStatus')
  }

  async unmuteStatus(_id: string): Promise<Response<Entity.Status>> {
    throw new NotImplementedError('unmuteStatus')
  }

  async pinStatus(id: string): Promise<Response<Entity.Status>> {
    await this.client.request('i/pin', { noteId: id })
    return this.getStatus(id)
  }

  async unpinStatus(id: string): Promise<Response<Entity.Status>> {
    await this.client.request('i/unpin', { noteId: id })
    return this.getStatus(id)
  }

  // =============================================
  // Media
  // =============================================

  async uploadMedia(
    _file: unknown,
    _options?: {
      description?: string
      focus?: string
    },
  ): Promise<Response<Entity.Attachment | Entity.AsyncAttachment>> {
    throw new NotImplementedError('uploadMedia')
  }

  async getMedia(_id: string): Promise<Response<Entity.Attachment>> {
    throw new NotImplementedError('getMedia')
  }

  async updateMedia(
    _id: string,
    _options?: {
      file?: unknown
      description?: string
      focus?: string
      is_sensitive?: boolean
    },
  ): Promise<Response<Entity.Attachment>> {
    throw new NotImplementedError('updateMedia')
  }

  // =============================================
  // Polls
  // =============================================

  async getPoll(_id: string): Promise<Response<Entity.Poll>> {
    throw new NotImplementedError('getPoll')
  }

  async votePoll(
    _id: string,
    _choices: Array<number>,
    _status_id?: string | null,
  ): Promise<Response<Entity.Poll>> {
    throw new NotImplementedError('votePoll')
  }

  // =============================================
  // Scheduled Statuses
  // =============================================

  async getScheduledStatuses(_options?: {
    limit?: number
    max_id?: string
    since_id?: string
    min_id?: string
  }): Promise<Response<Array<Entity.ScheduledStatus>>> {
    return wrapResponse([])
  }

  async getScheduledStatus(
    _id: string,
  ): Promise<Response<Entity.ScheduledStatus>> {
    throw new NotImplementedError('getScheduledStatus')
  }

  async scheduleStatus(
    _id: string,
    _scheduledAt?: string | null,
  ): Promise<Response<Entity.ScheduledStatus>> {
    throw new NotImplementedError('scheduleStatus')
  }

  async cancelScheduledStatus(
    _id: string,
  ): Promise<Response<Record<string, never>>> {
    throw new NotImplementedError('cancelScheduledStatus')
  }

  // =============================================
  // Timelines
  // =============================================

  async getPublicTimeline(options?: {
    only_media?: boolean
    limit?: number
    max_id?: string
    since_id?: string
    min_id?: string
  }): Promise<Response<Array<Entity.Status>>> {
    const notes = await this.client.request('notes/global-timeline', {
      limit: options?.limit ?? 20,
      ...(options?.max_id ? { untilId: options.max_id } : {}),
      ...(options?.since_id ? { sinceId: options.since_id } : {}),
      ...(options?.only_media ? { withFiles: true } : {}),
    })
    return wrapResponse(notes.map((n) => mapNoteToStatus(n, this.origin)))
  }

  async getLocalTimeline(options?: {
    only_media?: boolean
    limit?: number
    max_id?: string
    since_id?: string
    min_id?: string
  }): Promise<Response<Array<Entity.Status>>> {
    const notes = await this.client.request('notes/local-timeline', {
      limit: options?.limit ?? 20,
      ...(options?.max_id ? { untilId: options.max_id } : {}),
      ...(options?.since_id ? { sinceId: options.since_id } : {}),
      ...(options?.only_media ? { withFiles: true } : {}),
    })
    return wrapResponse(notes.map((n) => mapNoteToStatus(n, this.origin)))
  }

  async getTagTimeline(
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
    const notes = await this.client.request('notes/search-by-tag', {
      limit: options?.limit ?? 20,
      tag: hashtag,
      ...(options?.max_id ? { untilId: options.max_id } : {}),
      ...(options?.since_id ? { sinceId: options.since_id } : {}),
    })
    return wrapResponse(notes.map((n) => mapNoteToStatus(n, this.origin)))
  }

  async getHomeTimeline(options?: {
    local?: boolean
    limit?: number
    max_id?: string
    since_id?: string
    min_id?: string
  }): Promise<Response<Array<Entity.Status>>> {
    const notes = await this.client.request('notes/timeline', {
      limit: options?.limit ?? 20,
      ...(options?.max_id ? { untilId: options.max_id } : {}),
      ...(options?.since_id ? { sinceId: options.since_id } : {}),
    })
    return wrapResponse(notes.map((n) => mapNoteToStatus(n, this.origin)))
  }

  async getListTimeline(
    listId: string,
    options?: {
      limit?: number
      max_id?: string
      since_id?: string
      min_id?: string
    },
  ): Promise<Response<Array<Entity.Status>>> {
    const notes = await this.client.request('notes/user-list-timeline', {
      limit: options?.limit ?? 20,
      listId,
      ...(options?.max_id ? { untilId: options.max_id } : {}),
      ...(options?.since_id ? { sinceId: options.since_id } : {}),
    })
    return wrapResponse(notes.map((n) => mapNoteToStatus(n, this.origin)))
  }

  async getConversationTimeline(_options?: {
    limit?: number
    max_id?: string
    since_id?: string
    min_id?: string
  }): Promise<Response<Array<Entity.Conversation>>> {
    throw new NotImplementedError('getConversationTimeline')
  }

  // =============================================
  // Lists
  // =============================================

  async deleteConversation(
    _id: string,
  ): Promise<Response<Record<string, never>>> {
    throw new NotImplementedError('deleteConversation')
  }

  async readConversation(_id: string): Promise<Response<Entity.Conversation>> {
    throw new NotImplementedError('readConversation')
  }

  async getLists(): Promise<Response<Array<Entity.List>>> {
    const lists = await this.client.request('users/lists/list', {})
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

  async getList(_id: string): Promise<Response<Entity.List>> {
    throw new NotImplementedError('getList')
  }

  async createList(_title: string): Promise<Response<Entity.List>> {
    throw new NotImplementedError('createList')
  }

  async updateList(
    _id: string,
    _title: string,
  ): Promise<Response<Entity.List>> {
    throw new NotImplementedError('updateList')
  }

  async deleteList(_id: string): Promise<Response<Record<string, never>>> {
    throw new NotImplementedError('deleteList')
  }

  async getAccountsInList(
    _id: string,
    _options?: {
      limit?: number
      max_id?: string
      since_id?: string
    },
  ): Promise<Response<Array<Entity.Account>>> {
    throw new NotImplementedError('getAccountsInList')
  }

  async addAccountsToList(
    _id: string,
    _accountIds: Array<string>,
  ): Promise<Response<Record<string, never>>> {
    throw new NotImplementedError('addAccountsToList')
  }

  async deleteAccountsFromList(
    _id: string,
    _accountIds: Array<string>,
  ): Promise<Response<Record<string, never>>> {
    throw new NotImplementedError('deleteAccountsFromList')
  }

  // =============================================
  // Markers
  // =============================================

  async getMarkers(
    _timeline: Array<string>,
  ): Promise<Response<Entity.Marker | Record<string, never>>> {
    return wrapResponse({})
  }

  async saveMarkers(_options?: {
    home?: { last_read_id: string }
    notifications?: { last_read_id: string }
  }): Promise<Response<Entity.Marker>> {
    throw new NotImplementedError('saveMarkers')
  }

  // =============================================
  // Notifications
  // =============================================

  async getNotifications(options?: {
    limit?: number
    max_id?: string
    since_id?: string
    min_id?: string
    exclude_types?: Array<Entity.NotificationType>
    account_id?: string
  }): Promise<Response<Array<Entity.Notification>>> {
    const notifications = await this.client.request('i/notifications', {
      limit: options?.limit ?? 20,
      ...(options?.max_id ? { untilId: options.max_id } : {}),
      ...(options?.since_id ? { sinceId: options.since_id } : {}),
    })
    return wrapResponse(
      notifications.map((n) => mapNotification(n, this.origin)),
    )
  }

  async getNotification(id: string): Promise<Response<Entity.Notification>> {
    // Misskey doesn't have a single notification endpoint; fetch recent and filter
    const notifications = await this.client.request('i/notifications', {
      limit: 100,
    })
    const target = notifications.find((n) => n.id === id)
    if (target) {
      return wrapResponse(mapNotification(target, this.origin))
    }
    throw new NotImplementedError('getNotification')
  }

  async dismissNotifications(): Promise<Response<Record<string, never>>> {
    await this.client.request('notifications/mark-all-as-read', {})
    return wrapResponse({} as Record<string, never>)
  }

  async dismissNotification(
    _id: string,
  ): Promise<Response<Record<string, never>>> {
    throw new NotImplementedError('dismissNotification')
  }

  async readNotifications(_options: {
    id?: string
    max_id?: string
  }): Promise<Response<Record<string, never>>> {
    await this.client.request('notifications/mark-all-as-read', {})
    return wrapResponse({} as Record<string, never>)
  }

  // =============================================
  // Push Subscriptions
  // =============================================

  async subscribePushNotification(
    _subscription: {
      endpoint: string
      keys: { p256dh: string; auth: string }
    },
    _data?: { alerts: Record<string, boolean> } | null,
  ): Promise<Response<Entity.PushSubscription>> {
    throw new NotImplementedError('subscribePushNotification')
  }

  async getPushSubscription(): Promise<Response<Entity.PushSubscription>> {
    throw new NotImplementedError('getPushSubscription')
  }

  async updatePushSubscription(
    _data?: { alerts: Record<string, boolean> } | null,
  ): Promise<Response<Entity.PushSubscription>> {
    throw new NotImplementedError('updatePushSubscription')
  }

  async deletePushSubscription(): Promise<Response<Record<string, never>>> {
    throw new NotImplementedError('deletePushSubscription')
  }

  // =============================================
  // Search
  // =============================================

  async search(
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
      const users = await this.client.request('users/search', {
        limit: options?.limit ?? 20,
        query: q,
      })
      results.accounts = users.map((u) =>
        mapUserLiteToAccount(
          u as unknown as Misskey.entities.UserLite,
          this.origin,
        ),
      )
    }

    if (!options?.type || options.type === 'statuses') {
      const notes = await this.client.request('notes/search', {
        limit: options?.limit ?? 20,
        query: q,
      })
      results.statuses = notes.map((n) => mapNoteToStatus(n, this.origin))
    }

    if (!options?.type || options.type === 'hashtags') {
      // Misskey doesn't have a dedicated hashtag search API
      // Return empty for now
      results.hashtags = []
    }

    return wrapResponse(results)
  }

  // =============================================
  // Instance
  // =============================================

  async getInstance(): Promise<Response<Entity.Instance>> {
    const meta = await this.client.request('meta', { detail: true })
    const m = meta as Record<string, unknown>
    return wrapResponse({
      approval_required: false,
      configuration: {
        statuses: {
          max_characters: (m.maxNoteTextLength as number) ?? 3000,
        },
        urls: {
          streaming: '',
        },
      },
      contact_account: null,
      description: (m.description as string) ?? '',
      email: (m.maintainerEmail as string) ?? '',
      languages: (m.langs as string[]) ?? [],
      max_toot_chars: (m.maxNoteTextLength as number) ?? 3000,
      registrations: false,
      rules: [],
      stats: {
        domain_count: 0,
        status_count: 0,
        user_count: 0,
      },
      title: (m.name as string) ?? '',
      uri: this.origin,
      urls: {
        streaming_api: '',
      },
      version: `Misskey ${(m.version as string) ?? ''}`,
    } as unknown as Entity.Instance)
  }

  async getInstancePeers(): Promise<Response<Array<string>>> {
    return wrapResponse([])
  }

  async getInstanceActivity(): Promise<Response<Array<Entity.Activity>>> {
    return wrapResponse([])
  }

  async getInstanceTrends(
    _limit?: number | null,
  ): Promise<Response<Array<Entity.Tag>>> {
    return wrapResponse([])
  }

  async getInstanceDirectory(_options?: {
    limit?: number
    offset?: number
    order?: 'active' | 'new'
    local?: boolean
  }): Promise<Response<Array<Entity.Account>>> {
    return wrapResponse([])
  }

  async getInstanceCustomEmojis(): Promise<Response<Array<Entity.Emoji>>> {
    const emojis = await this.client.request('emojis', {})
    const emojiList =
      (
        emojis as {
          emojis: Array<{
            name: string
            url: string
            category?: string
            aliases?: string[]
          }>
        }
      ).emojis ?? []
    return wrapResponse(
      emojiList.map((e) => ({
        category: e.category ?? undefined,
        shortcode: e.name,
        static_url: ensureAbsoluteUrl(e.url),
        url: ensureAbsoluteUrl(e.url),
        visible_in_picker: true,
      })),
    )
  }

  async getInstanceAnnouncements(): Promise<
    Response<Array<Entity.Announcement>>
  > {
    return wrapResponse([])
  }

  async dismissInstanceAnnouncement(
    _id: string,
  ): Promise<Response<Record<never, never>>> {
    throw new NotImplementedError('dismissInstanceAnnouncement')
  }

  async addReactionToAnnouncement(
    _id: string,
    _name: string,
  ): Promise<Response<Record<never, never>>> {
    throw new NotImplementedError('addReactionToAnnouncement')
  }

  async removeReactionFromAnnouncement(
    _id: string,
    _name: string,
  ): Promise<Response<Record<never, never>>> {
    throw new NotImplementedError('removeReactionFromAnnouncement')
  }

  // =============================================
  // Emoji Reactions
  // =============================================

  async createEmojiReaction(
    id: string,
    emoji: string,
  ): Promise<Response<Entity.Status>> {
    await this.client.request('notes/reactions/create', {
      noteId: id,
      reaction: emoji,
    })
    return this.getStatus(id)
  }

  async deleteEmojiReaction(
    id: string,
    _emoji: string,
  ): Promise<Response<Entity.Status>> {
    await this.client.request('notes/reactions/delete', { noteId: id })
    return this.getStatus(id)
  }

  async getEmojiReactions(
    id: string,
  ): Promise<Response<Array<Entity.Reaction>>> {
    const note = await this.client.request('notes/show', { noteId: id })
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

  async getEmojiReaction(
    id: string,
    emoji: string,
  ): Promise<Response<Entity.Reaction>> {
    const res = await this.getEmojiReactions(id)
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

  // =============================================
  // Streaming
  // =============================================

  async streamingURL(): Promise<string> {
    return this.origin
  }

  async userStreaming(): Promise<WebSocketInterface> {
    const adapter = new MisskeyWebSocketAdapter(
      this.origin,
      this.credential ?? '',
      'homeTimeline',
    )
    adapter.start()
    return adapter
  }

  async publicStreaming(): Promise<WebSocketInterface> {
    const adapter = new MisskeyWebSocketAdapter(
      this.origin,
      this.credential ?? '',
      'globalTimeline',
    )
    adapter.start()
    return adapter
  }

  async localStreaming(): Promise<WebSocketInterface> {
    const adapter = new MisskeyWebSocketAdapter(
      this.origin,
      this.credential ?? '',
      'localTimeline',
    )
    adapter.start()
    return adapter
  }

  async tagStreaming(tag: string): Promise<WebSocketInterface> {
    const adapter = new MisskeyWebSocketAdapter(
      this.origin,
      this.credential ?? '',
      'hashtag',
      { tag },
    )
    adapter.start()
    return adapter
  }

  async listStreaming(_listId: string): Promise<WebSocketInterface> {
    throw new NotImplementedError('listStreaming')
  }

  async directStreaming(): Promise<WebSocketInterface> {
    throw new NotImplementedError('directStreaming')
  }
}
