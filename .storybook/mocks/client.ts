import type { MegalodonInterface, Response } from 'megalodon'
import { fn } from 'storybook/test'
import type { App } from 'types/types'
import {
  account,
  boostedStatus,
  mediaStatus,
  otherAccount,
  pollStatus,
  relationship,
  status,
} from '../../src/stories/support/fixtures'

export const response = <T>(data: T): Response<T> => ({
  data,
  headers: {},
  status: 200,
  statusText: 'OK',
})
export const client = {
  bookmarkStatus: fn(async () => response({ ...status, bookmarked: true })),
  createEmojiReaction: fn(async () => response(status)),
  deleteEmojiReaction: fn(async () => response(status)),
  favouriteStatus: fn(async () => response({ ...status, favourited: true })),
  followAccount: fn(async () => response({ ...relationship, following: true })),
  getAccount: fn(async () => response(account)),
  getAccountStatuses: fn(
    async (_id: string, options?: { max_id?: string; only_media?: boolean }) =>
      response(
        options?.max_id
          ? []
          : options?.only_media
            ? [mediaStatus]
            : [status, mediaStatus, boostedStatus],
      ),
  ),
  getRelationship: fn(async () => response(relationship)),
  getStatus: fn(async () => response(status)),
  getStatusContext: fn(async () =>
    response({
      ancestors: [],
      descendants: [
        {
          ...status,
          account: otherAccount,
          content: '<p>すてきな景色ですね！</p>',
          id: 'reply-1',
        },
      ],
    }),
  ),
  postStatus: fn(async () => response(status)),
  reblogStatus: fn(async () => response({ ...status, reblogged: true })),
  search: fn(async () =>
    response({ accounts: [account], hashtags: [], statuses: [status] }),
  ),
  searchAccount: fn(async () => response([account])),
  subscribeAccount: fn(async () =>
    response({ ...relationship, notifying: true }),
  ),
  unbookmarkStatus: fn(async () => response({ ...status, bookmarked: false })),
  unfavouriteStatus: fn(async () => response({ ...status, favourited: false })),
  unfollowAccount: fn(async () =>
    response({ ...relationship, following: false }),
  ),
  unreblogStatus: fn(async () => response({ ...status, reblogged: false })),
  unsubscribeAccount: fn(async () =>
    response({ ...relationship, notifying: false }),
  ),
  uploadMedia: fn(async () => response(mediaStatus.media_attachments[0])),
  verifyAccountCredentials: fn(async () => response(account)),
  votePoll: fn(async () => response({ ...pollStatus.poll, voted: true })),
} satisfies Partial<MegalodonInterface>

// Fail closed for unsupported API methods: never instantiate a real Fediverse client.
export const GetClient = (_app: App): MegalodonInterface =>
  new Proxy(client, {
    get(target, key) {
      if (key in target) return Reflect.get(target, key)
      throw new Error(`Storybook API fixture is missing: ${String(key)}`)
    },
  }) as unknown as MegalodonInterface
