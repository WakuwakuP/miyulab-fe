import type { MegalodonInterface } from 'megalodon'
import type { TimelineConfigV2 } from 'types/types'
import { bulkUpsertStatuses } from 'util/db/statusStore'

/**
 * タイムライン種別に応じた初期データ取得
 *
 * API の only_media パラメータが使える場合は API 側でフィルタし、
 * 使えない場合は全件取得して表示層でフィルタする。
 *
 * - home: StatusStoreProvider が userStreaming + getHomeTimeline で管理するため対象外
 * - local: only_media 対応 → API パラメータ使用
 * - public: only_media 対応 → API パラメータ使用
 * - tag: only_media 非対応 → 全件取得（表示層フィルタ）
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
      const res = await client.getLocalTimeline({
        limit,
        only_media: config.onlyMedia ?? false,
      })
      await bulkUpsertStatuses(res.data, backendUrl, 'local')
      break
    }

    case 'public': {
      const res = await client.getPublicTimeline({
        limit,
        only_media: config.onlyMedia ?? false,
      })
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
export async function fetchMoreData(
  client: MegalodonInterface,
  config: TimelineConfigV2,
  backendUrl: string,
  maxId: string,
): Promise<number> {
  const limit = 40

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
        only_media: config.onlyMedia ?? false,
      })
      await bulkUpsertStatuses(res.data, backendUrl, 'local')
      return res.data.length
    }

    case 'public': {
      const res = await client.getPublicTimeline({
        limit,
        max_id: maxId,
        only_media: config.onlyMedia ?? false,
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
        // このタグの最古の投稿を取得
        const { db } = await import('util/db/database')
        const oldestForTag = await db.statuses
          .where('belongingTags')
          .equals(tag)
          .and((s) => s.backendUrl === backendUrl)
          .reverse()
          .first()

        const tagMaxId = oldestForTag?.id ?? maxId

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
