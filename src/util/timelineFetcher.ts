import type { MegalodonInterface } from 'megalodon'
import type { App, TimelineConfigV2 } from 'types/types'
import { bulkAddNotifications } from 'util/db/sqlite/notificationStore'
import { bulkUpsertStatuses } from 'util/db/sqlite/statusStore'
import type { DbHandle as DbHandleType } from 'util/db/sqlite/types'

/**
 * タイムライン種別に応じた初期データ取得
 *
 * 全件取得して表示層でフィルタする（only_media 等の API パラメータは使用しない）。
 *
 * - home: StatusStoreProvider が userStreaming + getHomeTimeline で管理するため対象外
 * - local: 全件取得（表示層フィルタ）
 * - public: 全件取得（表示層フィルタ）
 * - tag: 全件取得（表示層フィルタ）
 *
 * ## home タイムラインについて
 * home タイムラインの初期データ取得は StatusStoreProvider が
 * 全アカウントに対して userStreaming() + getHomeTimeline() を実行することで
 * 既に担当している。この関数では home を扱わない。
 * 呼び出し側（UnifiedTimeline）でも config.type === 'home' の場合は
 * この関数を呼ばないようにガードする。
 */
export async function fetchInitialData(
  client: MegalodonInterface,
  config: TimelineConfigV2,
  backendUrl: string,
): Promise<void> {
  const limit = 40

  switch (config.type) {
    case 'home':
      // StatusStoreProvider が担当するため何もしない
      break

    case 'local': {
      const res = await client.getLocalTimeline({ limit })
      await bulkUpsertStatuses(res.data, backendUrl, 'local')
      break
    }

    case 'public': {
      const res = await client.getPublicTimeline({ limit })
      await bulkUpsertStatuses(res.data, backendUrl, 'public')
      break
    }

    case 'tag': {
      const tags = config.tagConfig?.tags ?? []
      // 各タグに対して個別に取得
      // onlyMedia は API パラメータ非対応のため表示層で行う
      for (const tag of tags) {
        const res = await client.getTagTimeline(tag, { limit })
        await bulkUpsertStatuses(res.data, backendUrl, 'tag', tag)
      }
      break
    }
  }
}

/**
 * 追加データ取得（スクロール末尾到達時）
 *
 * max_id で oldest の id を指定してページネーションする。
 * 複数 backendUrl の場合、各 backend の最古の id を個別に追跡する必要がある。
 */
/** API 1回あたりの取得件数 */
export const FETCH_LIMIT = 40

export async function fetchMoreData(
  client: MegalodonInterface,
  config: TimelineConfigV2,
  backendUrl: string,
  maxId: string,
): Promise<number> {
  const limit = FETCH_LIMIT

  switch (config.type) {
    case 'home': {
      const res = await client.getHomeTimeline({ limit, max_id: maxId })
      await bulkUpsertStatuses(res.data, backendUrl, 'home')
      return res.data.length
    }

    case 'local': {
      const res = await client.getLocalTimeline({
        limit,
        max_id: maxId,
      })
      await bulkUpsertStatuses(res.data, backendUrl, 'local')
      return res.data.length
    }

    case 'public': {
      const res = await client.getPublicTimeline({
        limit,
        max_id: maxId,
      })
      await bulkUpsertStatuses(res.data, backendUrl, 'public')
      return res.data.length
    }

    case 'tag': {
      const tags = config.tagConfig?.tags ?? []
      let total = 0
      // 各タグごとに個別のmaxIdでページングする
      // （同じmaxIdを使うと、タグごとに異なるタイムラインのため
      //  一部のタグで投稿がスキップされる可能性がある）
      for (const tag of tags) {
        // このタグの最古の投稿を取得 (SQLite)
        const { getSqliteDb } = await import('util/db/sqlite/connection')
        const handle = await getSqliteDb()
        const rows = (await handle.execAsync(
          `SELECT pbi.local_id FROM posts p
           INNER JOIN post_hashtags pht ON p.id = pht.post_id
           INNER JOIN hashtags ht ON pht.hashtag_id = ht.id
           INNER JOIN post_backend_ids pbi ON p.id = pbi.post_id
           INNER JOIN local_accounts la ON pbi.local_account_id = la.id
           WHERE ht.name = LOWER(?) AND la.backend_url = ?
           ORDER BY p.created_at_ms ASC
           LIMIT 1;`,
          {
            bind: [tag, backendUrl],
            // API ページネーション用の補助 Read（表示タイムライン構築ではない）→ other
            kind: 'other',
            returnValue: 'resultRows',
          },
        )) as string[][]

        let tagMaxId = maxId
        if (rows.length > 0) {
          tagMaxId = rows[0][0] as string
        }

        const res = await client.getTagTimeline(tag, {
          limit,
          max_id: tagMaxId,
        })
        await bulkUpsertStatuses(res.data, backendUrl, 'tag', tag)
        total += res.data.length
      }
      return total
    }

    default:
      return 0
  }
}

/**
 * 通知の追加データ取得（スクロール末尾到達時）
 *
 * max_id で oldest の id を指定してページネーションする。
 */
export async function fetchMoreNotifications(
  client: MegalodonInterface,
  backendUrl: string,
  maxId: string,
): Promise<number> {
  const limit = FETCH_LIMIT

  const res = await client.getNotifications({ limit, max_id: maxId })
  await bulkAddNotifications(res.data, backendUrl)
  return res.data.length
}

// --------------- 共通 API フォールバック ---------------

/**
 * 各 backendUrl ごとに DB 内の最古 ID を算出し、API から追加データを取得する。
 *
 * 3 つのタイムラインコンポーネント (UnifiedTimeline, MixedTimeline, NotificationTimeline)
 * で重複していたロジックを統合。
 *
 * @param config — タイムライン設定
 * @param apps — アプリ一覧 (GetClient 用 App オブジェクト)
 * @param targetBackendUrls — 対象バックエンド URL
 * @param exhaustedBackends — 取得済みバックエンド (これ以上データなし)
 * @param includeNotifications — 通知も取得するか（mixed タイムラインで true）
 */
export async function fetchOlderFromApi(
  config: TimelineConfigV2,
  apps: App[],
  targetBackendUrls: string[],
  exhaustedBackends: Set<string>,
  includeNotifications?: boolean,
): Promise<void> {
  const activeUrls = targetBackendUrls.filter(
    (url) => !exhaustedBackends.has(url),
  )
  if (activeUrls.length === 0) return

  const { getSqliteDb } = await import('util/db/sqlite/connection')
  const { GetClient } = await import('util/GetClient')

  const fetchStatuses = config.type !== 'notification'
  const fetchNotifs =
    config.type === 'notification' || includeNotifications === true

  await Promise.all(
    activeUrls.map(async (url) => {
      const app = apps.find((a) => a.backendUrl === url)
      if (!app) return

      const handle = await getSqliteDb()
      const client = GetClient(app)

      // ステータスタイムラインの追加取得
      if (fetchStatuses) {
        const oldestId = await getOldestStatusId(handle, config, url)

        if (!oldestId) {
          try {
            await fetchInitialData(client, config, url)
          } catch (error) {
            console.error(`Failed to fetch initial data for ${url}:`, error)
          }
          return
        }

        try {
          const count = await fetchMoreData(client, config, url, oldestId)
          if (count < FETCH_LIMIT) {
            exhaustedBackends.add(url)
          }
        } catch (error) {
          console.error(`Failed to fetch more data for ${url}:`, error)
        }
      }

      // 通知の追加取得
      if (fetchNotifs) {
        const oldestNotifId = await getOldestNotificationId(handle, url)

        if (oldestNotifId) {
          try {
            const count = await fetchMoreNotifications(
              client,
              url,
              oldestNotifId,
            )
            if (count < FETCH_LIMIT) {
              exhaustedBackends.add(url)
            }
          } catch (error) {
            console.error(
              `Failed to fetch more notifications for ${url}:`,
              error,
            )
          }
        }
      }
    }),
  )
}

// --------------- DB 最古 ID 検索ヘルパー ---------------

async function getOldestStatusId(
  handle: DbHandleType,
  config: TimelineConfigV2,
  backendUrl: string,
): Promise<string | undefined> {
  if (config.type === 'tag') {
    const tags = config.tagConfig?.tags ?? []
    for (const tag of tags) {
      const rows = (await handle.execAsync(
        `SELECT pb2.local_id
         FROM posts p
         INNER JOIN post_backend_ids pb2 ON pb2.post_id = p.id
         INNER JOIN post_hashtags pht ON pht.post_id = p.id
         INNER JOIN hashtags ht ON pht.hashtag_id = ht.id
         INNER JOIN local_accounts la ON la.id = pb2.local_account_id
         WHERE LOWER(ht.name) = LOWER(?) AND la.backend_url = ?
         ORDER BY p.created_at_ms ASC
         LIMIT 1;`,
        {
          bind: [tag, backendUrl],
          kind: 'other',
          returnValue: 'resultRows',
        },
      )) as string[][]
      if (rows.length > 0) return rows[0][0]
    }
    return undefined
  }

  const timelineType = config.type as 'home' | 'local' | 'public'
  const rows = (await handle.execAsync(
    `SELECT pb2.local_id
     FROM posts p
     INNER JOIN post_backend_ids pb2 ON pb2.post_id = p.id
     INNER JOIN local_accounts la ON la.id = pb2.local_account_id
     INNER JOIN timeline_entries te ON te.post_id = p.id AND te.local_account_id = la.id
     WHERE la.backend_url = ? AND te.timeline_key = ?
     ORDER BY p.created_at_ms ASC
     LIMIT 1;`,
    {
      bind: [backendUrl, timelineType],
      kind: 'other',
      returnValue: 'resultRows',
    },
  )) as string[][]
  return rows.length > 0 ? rows[0][0] : undefined
}

async function getOldestNotificationId(
  handle: DbHandleType,
  backendUrl: string,
): Promise<string | undefined> {
  const rows = (await handle.execAsync(
    `SELECT n.local_id
     FROM notifications n
     INNER JOIN local_accounts la ON la.id = n.local_account_id
     WHERE la.backend_url = ?
     ORDER BY n.created_at_ms ASC
     LIMIT 1;`,
    {
      bind: [backendUrl],
      kind: 'other',
      returnValue: 'resultRows',
    },
  )) as string[][]
  return rows.length > 0 ? rows[0][0] : undefined
}
