import type { Entity, Response } from 'megalodon'
import {
  type MisskeyClientContext,
  NotImplementedError,
  wrapResponse,
} from './helpers'
import { ensureAbsoluteUrl } from './mappers'

// =============================================
// Bookmarks / Favourites / Mutes / Blocks
// =============================================

export async function getBookmarks(_options?: {
  limit?: number
  max_id?: string
  since_id?: string
  min_id?: string
}): Promise<Response<Array<Entity.Status>>> {
  throw new NotImplementedError('getBookmarks')
}

export async function getFavourites(_options?: {
  limit?: number
  max_id?: string
  min_id?: string
}): Promise<Response<Array<Entity.Status>>> {
  throw new NotImplementedError('getFavourites')
}

export async function getMutes(_options?: {
  limit?: number
  max_id?: string
  min_id?: string
}): Promise<Response<Array<Entity.Account>>> {
  throw new NotImplementedError('getMutes')
}

export async function getBlocks(_options?: {
  limit?: number
  max_id?: string
  min_id?: string
}): Promise<Response<Array<Entity.Account>>> {
  throw new NotImplementedError('getBlocks')
}

export async function getDomainBlocks(_options?: {
  limit?: number
  max_id?: string
  min_id?: string
}): Promise<Response<Array<string>>> {
  throw new NotImplementedError('getDomainBlocks')
}

export async function blockDomain(
  _domain: string,
): Promise<Response<Record<string, never>>> {
  throw new NotImplementedError('blockDomain')
}

export async function unblockDomain(
  _domain: string,
): Promise<Response<Record<string, never>>> {
  throw new NotImplementedError('unblockDomain')
}

// =============================================
// Filters
// =============================================

export async function getFilters(): Promise<Response<Array<Entity.Filter>>> {
  return wrapResponse([])
}

export async function getFilter(_id: string): Promise<Response<Entity.Filter>> {
  throw new NotImplementedError('getFilter')
}

export async function createFilter(
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

export async function updateFilter(
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

export async function deleteFilter(
  _id: string,
): Promise<Response<Entity.Filter>> {
  throw new NotImplementedError('deleteFilter')
}

// =============================================
// Reports
// =============================================

export async function report(
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
// Endorsements / Featured Tags / Suggestions
// =============================================

export async function getEndorsements(_options?: {
  limit?: number
  max_id?: string
  since_id?: string
}): Promise<Response<Array<Entity.Account>>> {
  return wrapResponse([])
}

export async function getFeaturedTags(): Promise<
  Response<Array<Entity.FeaturedTag>>
> {
  return wrapResponse([])
}

export async function createFeaturedTag(
  _name: string,
): Promise<Response<Entity.FeaturedTag>> {
  throw new NotImplementedError('createFeaturedTag')
}

export async function deleteFeaturedTag(
  _id: string,
): Promise<Response<Record<string, never>>> {
  throw new NotImplementedError('deleteFeaturedTag')
}

export async function getSuggestedTags(): Promise<Response<Array<Entity.Tag>>> {
  return wrapResponse([])
}

export async function getPreferences(): Promise<Response<Entity.Preferences>> {
  throw new NotImplementedError('getPreferences')
}

export async function getFollowedTags(): Promise<Response<Array<Entity.Tag>>> {
  return wrapResponse([])
}

export async function getSuggestions(
  _limit?: number,
): Promise<Response<Array<Entity.Account>>> {
  return wrapResponse([])
}

export async function getTag(_id: string): Promise<Response<Entity.Tag>> {
  throw new NotImplementedError('getTag')
}

export async function followTag(_id: string): Promise<Response<Entity.Tag>> {
  throw new NotImplementedError('followTag')
}

export async function unfollowTag(_id: string): Promise<Response<Entity.Tag>> {
  throw new NotImplementedError('unfollowTag')
}

// =============================================
// Instance
// =============================================

export async function getInstance(
  ctx: MisskeyClientContext,
): Promise<Response<Entity.Instance>> {
  const meta = await ctx.client.request('meta', { detail: true })
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
    uri: ctx.origin,
    urls: {
      streaming_api: '',
    },
    version: `Misskey ${(m.version as string) ?? ''}`,
  } as unknown as Entity.Instance)
}

export async function getInstancePeers(): Promise<Response<Array<string>>> {
  return wrapResponse([])
}

export async function getInstanceActivity(): Promise<
  Response<Array<Entity.Activity>>
> {
  return wrapResponse([])
}

export async function getInstanceTrends(
  _limit?: number | null,
): Promise<Response<Array<Entity.Tag>>> {
  return wrapResponse([])
}

export async function getInstanceDirectory(_options?: {
  limit?: number
  offset?: number
  order?: 'active' | 'new'
  local?: boolean
}): Promise<Response<Array<Entity.Account>>> {
  return wrapResponse([])
}

export async function getInstanceCustomEmojis(
  ctx: MisskeyClientContext,
): Promise<Response<Array<Entity.Emoji>>> {
  const emojis = await ctx.client.request('emojis', {})
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

export async function getInstanceAnnouncements(): Promise<
  Response<Array<Entity.Announcement>>
> {
  return wrapResponse([])
}

export async function dismissInstanceAnnouncement(
  _id: string,
): Promise<Response<Record<never, never>>> {
  throw new NotImplementedError('dismissInstanceAnnouncement')
}

export async function addReactionToAnnouncement(
  _id: string,
  _name: string,
): Promise<Response<Record<never, never>>> {
  throw new NotImplementedError('addReactionToAnnouncement')
}

export async function removeReactionFromAnnouncement(
  _id: string,
  _name: string,
): Promise<Response<Record<never, never>>> {
  throw new NotImplementedError('removeReactionFromAnnouncement')
}
