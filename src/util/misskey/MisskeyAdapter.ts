import type {
  Entity,
  MegalodonInterface,
  OAuth,
  Response,
  WebSocketInterface,
} from 'megalodon'
import * as Misskey from 'misskey-js'
import * as accountOps from './accountOperations'
import type { MisskeyClientContext } from './helpers'
import * as instanceOps from './instanceOperations'
import * as notificationOps from './notificationOperations'
import * as statusOps from './statusOperations'
import * as streamingOps from './streamingOperations'
import * as timelineOps from './timelineOperations'

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

  private get ctx(): MisskeyClientContext {
    return {
      client: this.client,
      credential: this.credential,
      origin: this.origin,
    }
  }

  // =============================================
  // OAuth / App Registration
  // =============================================

  cancel(): void {
    accountOps.cancel()
  }

  async registerApp(
    clientName: string,
    options: Partial<{
      scopes: Array<string>
      redirect_uris: string
      website: string
    }>,
  ): Promise<OAuth.AppData> {
    return accountOps.registerApp(this.ctx, clientName, options)
  }

  async createApp(
    clientName: string,
    options: Partial<{
      scopes: Array<string>
      redirect_uris: string
      website: string
    }>,
  ): Promise<OAuth.AppData> {
    return accountOps.createApp(this.ctx, clientName, options)
  }

  async fetchAccessToken(
    clientId: string | null,
    clientSecret: string,
    code: string,
    redirectUri?: string,
  ): Promise<OAuth.TokenData> {
    return accountOps.fetchAccessToken(
      this.ctx,
      clientId,
      clientSecret,
      code,
      redirectUri,
    )
  }

  async refreshToken(
    clientId: string,
    clientSecret: string,
    refreshTokenValue: string,
  ): Promise<OAuth.TokenData> {
    return accountOps.refreshToken(clientId, clientSecret, refreshTokenValue)
  }

  async revokeToken(
    clientId: string,
    clientSecret: string,
    token: string,
  ): Promise<Response<Record<string, never>>> {
    return accountOps.revokeToken(clientId, clientSecret, token)
  }

  async verifyAppCredentials(): Promise<Response<Entity.Application>> {
    return accountOps.verifyAppCredentials()
  }

  async registerAccount(
    username: string,
    email: string,
    password: string,
    agreement: boolean,
    locale: string,
    reason?: string | null,
  ): Promise<Response<Entity.Token>> {
    return accountOps.registerAccount(
      username,
      email,
      password,
      agreement,
      locale,
      reason,
    )
  }

  // =============================================
  // Account
  // =============================================

  async verifyAccountCredentials(): Promise<Response<Entity.Account>> {
    return accountOps.verifyAccountCredentials(this.ctx)
  }

  async updateCredentials(
    options?: Record<string, unknown>,
  ): Promise<Response<Entity.Account>> {
    return accountOps.updateCredentials(options)
  }

  async getAccount(id: string): Promise<Response<Entity.Account>> {
    return accountOps.getAccount(this.ctx, id)
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
    return accountOps.getAccountStatuses(this.ctx, id, options)
  }

  async getAccountFavourites(
    id: string,
    options?: {
      limit?: number
      max_id?: string
      since_id?: string
    },
  ): Promise<Response<Array<Entity.Status>>> {
    return accountOps.getAccountFavourites(id, options)
  }

  async subscribeAccount(id: string): Promise<Response<Entity.Relationship>> {
    return accountOps.subscribeAccount(id)
  }

  async unsubscribeAccount(id: string): Promise<Response<Entity.Relationship>> {
    return accountOps.unsubscribeAccount(id)
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
    return accountOps.getAccountFollowers(this.ctx, id, options)
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
    return accountOps.getAccountFollowing(this.ctx, id, options)
  }

  async getAccountLists(id: string): Promise<Response<Array<Entity.List>>> {
    return accountOps.getAccountLists(id)
  }

  async getIdentityProof(
    id: string,
  ): Promise<Response<Array<Entity.IdentityProof>>> {
    return accountOps.getIdentityProof(id)
  }

  async followAccount(
    id: string,
    options?: { reblog?: boolean },
  ): Promise<Response<Entity.Relationship>> {
    return accountOps.followAccount(this.ctx, id, options)
  }

  async unfollowAccount(id: string): Promise<Response<Entity.Relationship>> {
    return accountOps.unfollowAccount(this.ctx, id)
  }

  async blockAccount(id: string): Promise<Response<Entity.Relationship>> {
    return accountOps.blockAccount(this.ctx, id)
  }

  async unblockAccount(id: string): Promise<Response<Entity.Relationship>> {
    return accountOps.unblockAccount(this.ctx, id)
  }

  async muteAccount(
    id: string,
    notifications: boolean,
  ): Promise<Response<Entity.Relationship>> {
    return accountOps.muteAccount(this.ctx, id, notifications)
  }

  async unmuteAccount(id: string): Promise<Response<Entity.Relationship>> {
    return accountOps.unmuteAccount(this.ctx, id)
  }

  async pinAccount(id: string): Promise<Response<Entity.Relationship>> {
    return accountOps.pinAccount(id)
  }

  async unpinAccount(id: string): Promise<Response<Entity.Relationship>> {
    return accountOps.unpinAccount(id)
  }

  async setAccountNote(
    id: string,
    note?: string,
  ): Promise<Response<Entity.Relationship>> {
    return accountOps.setAccountNote(id, note)
  }

  async getRelationship(id: string): Promise<Response<Entity.Relationship>> {
    return accountOps.getRelationship(this.ctx, id)
  }

  async getRelationships(
    ids: Array<string>,
  ): Promise<Response<Array<Entity.Relationship>>> {
    return accountOps.getRelationships(this.ctx, ids)
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
    return accountOps.searchAccount(this.ctx, q, options)
  }

  async lookupAccount(acct: string): Promise<Response<Entity.Account>> {
    return accountOps.lookupAccount(this.ctx, acct)
  }

  // =============================================
  // Bookmarks / Favourites / Mutes / Blocks
  // =============================================

  async getBookmarks(options?: {
    limit?: number
    max_id?: string
    since_id?: string
    min_id?: string
  }): Promise<Response<Array<Entity.Status>>> {
    return instanceOps.getBookmarks(options)
  }

  async getFavourites(options?: {
    limit?: number
    max_id?: string
    min_id?: string
  }): Promise<Response<Array<Entity.Status>>> {
    return instanceOps.getFavourites(options)
  }

  async getMutes(options?: {
    limit?: number
    max_id?: string
    min_id?: string
  }): Promise<Response<Array<Entity.Account>>> {
    return instanceOps.getMutes(options)
  }

  async getBlocks(options?: {
    limit?: number
    max_id?: string
    min_id?: string
  }): Promise<Response<Array<Entity.Account>>> {
    return instanceOps.getBlocks(options)
  }

  async getDomainBlocks(options?: {
    limit?: number
    max_id?: string
    min_id?: string
  }): Promise<Response<Array<string>>> {
    return instanceOps.getDomainBlocks(options)
  }

  async blockDomain(domain: string): Promise<Response<Record<string, never>>> {
    return instanceOps.blockDomain(domain)
  }

  async unblockDomain(
    domain: string,
  ): Promise<Response<Record<string, never>>> {
    return instanceOps.unblockDomain(domain)
  }

  // =============================================
  // Filters
  // =============================================

  async getFilters(): Promise<Response<Array<Entity.Filter>>> {
    return instanceOps.getFilters()
  }

  async getFilter(id: string): Promise<Response<Entity.Filter>> {
    return instanceOps.getFilter(id)
  }

  async createFilter(
    phrase: string,
    context: Array<Entity.FilterContext>,
    options?: {
      irreversible?: boolean
      whole_word?: boolean
      expires_in?: string
    },
  ): Promise<Response<Entity.Filter>> {
    return instanceOps.createFilter(phrase, context, options)
  }

  async updateFilter(
    id: string,
    phrase: string,
    context: Array<Entity.FilterContext>,
    options?: {
      irreversible?: boolean
      whole_word?: boolean
      expires_in?: string
    },
  ): Promise<Response<Entity.Filter>> {
    return instanceOps.updateFilter(id, phrase, context, options)
  }

  async deleteFilter(id: string): Promise<Response<Entity.Filter>> {
    return instanceOps.deleteFilter(id)
  }

  // =============================================
  // Reports
  // =============================================

  async report(
    accountId: string,
    options?: {
      status_ids?: Array<string>
      comment: string
      forward?: boolean
      category?: Entity.Category
      rule_ids?: Array<number>
    },
  ): Promise<Response<Entity.Report>> {
    return instanceOps.report(accountId, options)
  }

  // =============================================
  // Follow Requests
  // =============================================

  async getFollowRequests(
    limit?: number,
  ): Promise<Response<Array<Entity.Account | Entity.FollowRequest>>> {
    return accountOps.getFollowRequests(this.ctx, limit)
  }

  async acceptFollowRequest(
    id: string,
  ): Promise<Response<Entity.Relationship>> {
    return accountOps.acceptFollowRequest(this.ctx, id)
  }

  async rejectFollowRequest(
    id: string,
  ): Promise<Response<Entity.Relationship>> {
    return accountOps.rejectFollowRequest(this.ctx, id)
  }

  // =============================================
  // Endorsements / Featured Tags / Suggestions
  // =============================================

  async getEndorsements(options?: {
    limit?: number
    max_id?: string
    since_id?: string
  }): Promise<Response<Array<Entity.Account>>> {
    return instanceOps.getEndorsements(options)
  }

  async getFeaturedTags(): Promise<Response<Array<Entity.FeaturedTag>>> {
    return instanceOps.getFeaturedTags()
  }

  async createFeaturedTag(name: string): Promise<Response<Entity.FeaturedTag>> {
    return instanceOps.createFeaturedTag(name)
  }

  async deleteFeaturedTag(
    id: string,
  ): Promise<Response<Record<string, never>>> {
    return instanceOps.deleteFeaturedTag(id)
  }

  async getSuggestedTags(): Promise<Response<Array<Entity.Tag>>> {
    return instanceOps.getSuggestedTags()
  }

  async getPreferences(): Promise<Response<Entity.Preferences>> {
    return instanceOps.getPreferences()
  }

  async getFollowedTags(): Promise<Response<Array<Entity.Tag>>> {
    return instanceOps.getFollowedTags()
  }

  async getSuggestions(
    limit?: number,
  ): Promise<Response<Array<Entity.Account>>> {
    return instanceOps.getSuggestions(limit)
  }

  async getTag(id: string): Promise<Response<Entity.Tag>> {
    return instanceOps.getTag(id)
  }

  async followTag(id: string): Promise<Response<Entity.Tag>> {
    return instanceOps.followTag(id)
  }

  async unfollowTag(id: string): Promise<Response<Entity.Tag>> {
    return instanceOps.unfollowTag(id)
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
    return statusOps.postStatus(this.ctx, status, options)
  }

  async getStatus(id: string): Promise<Response<Entity.Status>> {
    return statusOps.getStatus(this.ctx, id)
  }

  async editStatus(
    id: string,
    options: {
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
    return statusOps.editStatus(id, options)
  }

  async deleteStatus(id: string): Promise<Response<Record<string, never>>> {
    return statusOps.deleteStatus(this.ctx, id)
  }

  async getStatusContext(
    id: string,
    options?: {
      limit?: number
      max_id?: string
      since_id?: string
    },
  ): Promise<Response<Entity.Context>> {
    return statusOps.getStatusContext(this.ctx, id, options)
  }

  async getStatusSource(id: string): Promise<Response<Entity.StatusSource>> {
    return statusOps.getStatusSource(id)
  }

  async getStatusRebloggedBy(
    id: string,
  ): Promise<Response<Array<Entity.Account>>> {
    return statusOps.getStatusRebloggedBy(this.ctx, id)
  }

  async getStatusFavouritedBy(
    id: string,
  ): Promise<Response<Array<Entity.Account>>> {
    return statusOps.getStatusFavouritedBy(this.ctx, id)
  }

  async favouriteStatus(id: string): Promise<Response<Entity.Status>> {
    return statusOps.favouriteStatus(this.ctx, id)
  }

  async unfavouriteStatus(id: string): Promise<Response<Entity.Status>> {
    return statusOps.unfavouriteStatus(this.ctx, id)
  }

  async reblogStatus(id: string): Promise<Response<Entity.Status>> {
    return statusOps.reblogStatus(this.ctx, id)
  }

  async unreblogStatus(id: string): Promise<Response<Entity.Status>> {
    return statusOps.unreblogStatus(this.ctx, id)
  }

  async bookmarkStatus(id: string): Promise<Response<Entity.Status>> {
    return statusOps.bookmarkStatus(this.ctx, id)
  }

  async unbookmarkStatus(id: string): Promise<Response<Entity.Status>> {
    return statusOps.unbookmarkStatus(this.ctx, id)
  }

  async muteStatus(id: string): Promise<Response<Entity.Status>> {
    return statusOps.muteStatus(id)
  }

  async unmuteStatus(id: string): Promise<Response<Entity.Status>> {
    return statusOps.unmuteStatus(id)
  }

  async pinStatus(id: string): Promise<Response<Entity.Status>> {
    return statusOps.pinStatus(this.ctx, id)
  }

  async unpinStatus(id: string): Promise<Response<Entity.Status>> {
    return statusOps.unpinStatus(this.ctx, id)
  }

  // =============================================
  // Media
  // =============================================

  async uploadMedia(
    file: unknown,
    options?: {
      description?: string
      focus?: string
    },
  ): Promise<Response<Entity.Attachment | Entity.AsyncAttachment>> {
    return statusOps.uploadMedia(file, options)
  }

  async getMedia(id: string): Promise<Response<Entity.Attachment>> {
    return statusOps.getMedia(id)
  }

  async updateMedia(
    id: string,
    options?: {
      file?: unknown
      description?: string
      focus?: string
      is_sensitive?: boolean
    },
  ): Promise<Response<Entity.Attachment>> {
    return statusOps.updateMedia(id, options)
  }

  // =============================================
  // Polls
  // =============================================

  async getPoll(id: string): Promise<Response<Entity.Poll>> {
    return statusOps.getPoll(id)
  }

  async votePoll(
    id: string,
    choices: Array<number>,
    status_id?: string | null,
  ): Promise<Response<Entity.Poll>> {
    return statusOps.votePoll(id, choices, status_id)
  }

  // =============================================
  // Scheduled Statuses
  // =============================================

  async getScheduledStatuses(options?: {
    limit?: number
    max_id?: string
    since_id?: string
    min_id?: string
  }): Promise<Response<Array<Entity.ScheduledStatus>>> {
    return statusOps.getScheduledStatuses(options)
  }

  async getScheduledStatus(
    id: string,
  ): Promise<Response<Entity.ScheduledStatus>> {
    return statusOps.getScheduledStatus(id)
  }

  async scheduleStatus(
    id: string,
    scheduledAt?: string | null,
  ): Promise<Response<Entity.ScheduledStatus>> {
    return statusOps.scheduleStatus(id, scheduledAt)
  }

  async cancelScheduledStatus(
    id: string,
  ): Promise<Response<Record<string, never>>> {
    return statusOps.cancelScheduledStatus(id)
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
    return timelineOps.getPublicTimeline(this.ctx, options)
  }

  async getLocalTimeline(options?: {
    only_media?: boolean
    limit?: number
    max_id?: string
    since_id?: string
    min_id?: string
  }): Promise<Response<Array<Entity.Status>>> {
    return timelineOps.getLocalTimeline(this.ctx, options)
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
    return timelineOps.getTagTimeline(this.ctx, hashtag, options)
  }

  async getHomeTimeline(options?: {
    local?: boolean
    limit?: number
    max_id?: string
    since_id?: string
    min_id?: string
  }): Promise<Response<Array<Entity.Status>>> {
    return timelineOps.getHomeTimeline(this.ctx, options)
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
    return timelineOps.getListTimeline(this.ctx, listId, options)
  }

  async getConversationTimeline(options?: {
    limit?: number
    max_id?: string
    since_id?: string
    min_id?: string
  }): Promise<Response<Array<Entity.Conversation>>> {
    return timelineOps.getConversationTimeline(options)
  }

  // =============================================
  // Conversations / Lists
  // =============================================

  async deleteConversation(
    id: string,
  ): Promise<Response<Record<string, never>>> {
    return timelineOps.deleteConversation(id)
  }

  async readConversation(id: string): Promise<Response<Entity.Conversation>> {
    return timelineOps.readConversation(id)
  }

  async getLists(): Promise<Response<Array<Entity.List>>> {
    return timelineOps.getLists(this.ctx)
  }

  async getList(id: string): Promise<Response<Entity.List>> {
    return timelineOps.getList(id)
  }

  async createList(title: string): Promise<Response<Entity.List>> {
    return timelineOps.createList(title)
  }

  async updateList(id: string, title: string): Promise<Response<Entity.List>> {
    return timelineOps.updateList(id, title)
  }

  async deleteList(id: string): Promise<Response<Record<string, never>>> {
    return timelineOps.deleteList(id)
  }

  async getAccountsInList(
    id: string,
    options?: {
      limit?: number
      max_id?: string
      since_id?: string
    },
  ): Promise<Response<Array<Entity.Account>>> {
    return timelineOps.getAccountsInList(id, options)
  }

  async addAccountsToList(
    id: string,
    accountIds: Array<string>,
  ): Promise<Response<Record<string, never>>> {
    return timelineOps.addAccountsToList(id, accountIds)
  }

  async deleteAccountsFromList(
    id: string,
    accountIds: Array<string>,
  ): Promise<Response<Record<string, never>>> {
    return timelineOps.deleteAccountsFromList(id, accountIds)
  }

  // =============================================
  // Markers
  // =============================================

  async getMarkers(
    timeline: Array<string>,
  ): Promise<Response<Entity.Marker | Record<string, never>>> {
    return timelineOps.getMarkers(timeline)
  }

  async saveMarkers(options?: {
    home?: { last_read_id: string }
    notifications?: { last_read_id: string }
  }): Promise<Response<Entity.Marker>> {
    return timelineOps.saveMarkers(options)
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
    return notificationOps.getNotifications(this.ctx, options)
  }

  async getNotification(id: string): Promise<Response<Entity.Notification>> {
    return notificationOps.getNotification(this.ctx, id)
  }

  async dismissNotifications(): Promise<Response<Record<string, never>>> {
    return notificationOps.dismissNotifications(this.ctx)
  }

  async dismissNotification(
    id: string,
  ): Promise<Response<Record<string, never>>> {
    return notificationOps.dismissNotification(id)
  }

  async readNotifications(options: {
    id?: string
    max_id?: string
  }): Promise<Response<Record<string, never>>> {
    return notificationOps.readNotifications(this.ctx, options)
  }

  // =============================================
  // Push Subscriptions
  // =============================================

  async subscribePushNotification(
    subscription: {
      endpoint: string
      keys: { p256dh: string; auth: string }
    },
    data?: { alerts: Record<string, boolean> } | null,
  ): Promise<Response<Entity.PushSubscription>> {
    return notificationOps.subscribePushNotification(subscription, data)
  }

  async getPushSubscription(): Promise<Response<Entity.PushSubscription>> {
    return notificationOps.getPushSubscription()
  }

  async updatePushSubscription(
    data?: { alerts: Record<string, boolean> } | null,
  ): Promise<Response<Entity.PushSubscription>> {
    return notificationOps.updatePushSubscription(data)
  }

  async deletePushSubscription(): Promise<Response<Record<string, never>>> {
    return notificationOps.deletePushSubscription()
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
    return timelineOps.search(this.ctx, q, options)
  }

  // =============================================
  // Instance
  // =============================================

  async getInstance(): Promise<Response<Entity.Instance>> {
    return instanceOps.getInstance(this.ctx)
  }

  async getInstancePeers(): Promise<Response<Array<string>>> {
    return instanceOps.getInstancePeers()
  }

  async getInstanceActivity(): Promise<Response<Array<Entity.Activity>>> {
    return instanceOps.getInstanceActivity()
  }

  async getInstanceTrends(
    limit?: number | null,
  ): Promise<Response<Array<Entity.Tag>>> {
    return instanceOps.getInstanceTrends(limit)
  }

  async getInstanceDirectory(options?: {
    limit?: number
    offset?: number
    order?: 'active' | 'new'
    local?: boolean
  }): Promise<Response<Array<Entity.Account>>> {
    return instanceOps.getInstanceDirectory(options)
  }

  async getInstanceCustomEmojis(): Promise<Response<Array<Entity.Emoji>>> {
    return instanceOps.getInstanceCustomEmojis(this.ctx)
  }

  async getInstanceAnnouncements(): Promise<
    Response<Array<Entity.Announcement>>
  > {
    return instanceOps.getInstanceAnnouncements()
  }

  async dismissInstanceAnnouncement(
    id: string,
  ): Promise<Response<Record<never, never>>> {
    return instanceOps.dismissInstanceAnnouncement(id)
  }

  async addReactionToAnnouncement(
    id: string,
    name: string,
  ): Promise<Response<Record<never, never>>> {
    return instanceOps.addReactionToAnnouncement(id, name)
  }

  async removeReactionFromAnnouncement(
    id: string,
    name: string,
  ): Promise<Response<Record<never, never>>> {
    return instanceOps.removeReactionFromAnnouncement(id, name)
  }

  // =============================================
  // Emoji Reactions
  // =============================================

  async createEmojiReaction(
    id: string,
    emoji: string,
  ): Promise<Response<Entity.Status>> {
    return statusOps.createEmojiReaction(this.ctx, id, emoji)
  }

  async deleteEmojiReaction(
    id: string,
    emoji: string,
  ): Promise<Response<Entity.Status>> {
    return statusOps.deleteEmojiReaction(this.ctx, id, emoji)
  }

  async getEmojiReactions(
    id: string,
  ): Promise<Response<Array<Entity.Reaction>>> {
    return statusOps.getEmojiReactions(this.ctx, id)
  }

  async getEmojiReaction(
    id: string,
    emoji: string,
  ): Promise<Response<Entity.Reaction>> {
    return statusOps.getEmojiReaction(this.ctx, id, emoji)
  }

  // =============================================
  // Streaming
  // =============================================

  async streamingURL(): Promise<string> {
    return streamingOps.streamingURL(this.ctx)
  }

  async userStreaming(): Promise<WebSocketInterface> {
    return streamingOps.userStreaming(this.ctx)
  }

  async publicStreaming(): Promise<WebSocketInterface> {
    return streamingOps.publicStreaming(this.ctx)
  }

  async localStreaming(): Promise<WebSocketInterface> {
    return streamingOps.localStreaming(this.ctx)
  }

  async tagStreaming(tag: string): Promise<WebSocketInterface> {
    return streamingOps.tagStreaming(this.ctx, tag)
  }

  async listStreaming(listId: string): Promise<WebSocketInterface> {
    return streamingOps.listStreaming(listId)
  }

  async directStreaming(): Promise<WebSocketInterface> {
    return streamingOps.directStreaming()
  }
}
