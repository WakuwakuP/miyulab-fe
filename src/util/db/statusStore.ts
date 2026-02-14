import Dexie, { type UpdateSpec } from 'dexie'
import type { Entity } from 'megalodon'
import { db, type StoredStatus, type TimelineType } from './database'

/**
 * 複合キー生成
 */
export function createCompositeKey(backendUrl: string, id: string): string {
  return `${backendUrl}:${id}`
}

/**
 * Entity.StatusをStoredStatusに変換
 *
 * ※ appIndex はDBに永続化しない。
 *   表示時に backendUrl から apps 配列を逆引きして都度算出する。
 *
 * ※ created_at_ms は created_at（ISO 8601文字列）を UnixTime ミリ秒に変換した数値。
 *   文字列ソートの不確実性を排除し、複合インデックスでの数値ソートを保証する。
 */
export function toStoredStatus(
  status: Entity.Status,
  backendUrl: string,
  timelineTypes: TimelineType[],
): StoredStatus {
  return {
    ...status,
    backendUrl,
    belongingTags: status.tags.map((tag) => tag.name),
    compositeKey: createCompositeKey(backendUrl, status.id),
    created_at_ms: new Date(status.created_at).getTime(),
    storedAt: Date.now(),
    timelineTypes,
  }
}

/**
 * Statusを追加または更新
 * - 既存のStatusがある場合はtimelineTypesをマージ
 */
export async function upsertStatus(
  status: Entity.Status,
  backendUrl: string,
  timelineType: TimelineType,
  tag?: string,
): Promise<void> {
  const compositeKey = createCompositeKey(backendUrl, status.id)

  await db.transaction('rw', db.statuses, async () => {
    const existing = await db.statuses.get(compositeKey)

    if (existing) {
      // 既存のStatusがある場合はtimelineTypesをマージ
      const updatedTimelineTypes = Array.from(
        new Set([...existing.timelineTypes, timelineType]),
      )
      const updatedBelongingTags = tag
        ? Array.from(new Set([...existing.belongingTags, tag]))
        : existing.belongingTags

      await db.statuses.update(compositeKey, {
        ...status,
        belongingTags: updatedBelongingTags,
        created_at_ms: new Date(status.created_at).getTime(),
        storedAt: Date.now(),
        timelineTypes: updatedTimelineTypes,
      })
    } else {
      // 新規追加
      const storedStatus = toStoredStatus(status, backendUrl, [timelineType])
      if (tag) {
        storedStatus.belongingTags = Array.from(
          new Set([...storedStatus.belongingTags, tag]),
        )
      }
      await db.statuses.add(storedStatus)
    }
  })
}

/**
 * 複数のStatusを一括追加（初期ロード用）
 */
export async function bulkUpsertStatuses(
  statuses: Entity.Status[],
  backendUrl: string,
  timelineType: TimelineType,
  tag?: string,
): Promise<void> {
  await db.transaction('rw', db.statuses, async () => {
    for (const status of statuses) {
      const compositeKey = createCompositeKey(backendUrl, status.id)
      const existing = await db.statuses.get(compositeKey)

      if (existing) {
        const updatedTimelineTypes = Array.from(
          new Set([...existing.timelineTypes, timelineType]),
        )
        const updatedBelongingTags = tag
          ? Array.from(new Set([...existing.belongingTags, tag]))
          : existing.belongingTags

        await db.statuses.update(compositeKey, {
          ...status,
          belongingTags: updatedBelongingTags,
          created_at_ms: new Date(status.created_at).getTime(),
          storedAt: Date.now(),
          timelineTypes: updatedTimelineTypes,
        })
      } else {
        const storedStatus = toStoredStatus(status, backendUrl, [timelineType])
        if (tag) {
          storedStatus.belongingTags = Array.from(
            new Set([...storedStatus.belongingTags, tag]),
          )
        }
        await db.statuses.add(storedStatus)
      }
    }
  })
}

/**
 * 特定タイムラインからStatusを除外（物理削除ではない）
 *
 * - timelineType='tag' かつ tag 指定時は belongingTags からも該当タグを除去する
 * - 最終的に timelineTypes が空になった場合のみ物理削除する
 */
export async function removeFromTimeline(
  backendUrl: string,
  statusId: string,
  timelineType: TimelineType,
  tag?: string,
): Promise<void> {
  const compositeKey = createCompositeKey(backendUrl, statusId)

  await db.transaction('rw', db.statuses, async () => {
    const existing = await db.statuses.get(compositeKey)
    if (!existing) return

    const updatedTimelineTypes = existing.timelineTypes.filter(
      (t) => t !== timelineType,
    )

    // tag TL除外時は belongingTags も更新
    let updatedBelongingTags = existing.belongingTags
    if (timelineType === 'tag' && tag) {
      updatedBelongingTags = existing.belongingTags.filter((t) => t !== tag)

      // まだ他のタグが残っている場合は timelineType 'tag' を復元
      if (
        updatedBelongingTags.length > 0 &&
        !updatedTimelineTypes.includes('tag')
      ) {
        updatedTimelineTypes.push('tag')
      }
    }

    if (updatedTimelineTypes.length === 0) {
      // どのタイムラインにも属さなくなったら物理削除
      await db.statuses.delete(compositeKey)
    } else {
      await db.statuses.update(compositeKey, {
        belongingTags: updatedBelongingTags,
        timelineTypes: updatedTimelineTypes,
      })
    }
  })
}

/**
 * deleteイベントの処理
 *
 * WebSocketの delete イベント受信時に呼び出す。
 * 受信したタイムライン種別から該当Statusを除外する。
 * 物理削除は最終的に全TLから外れた場合にのみ行う。
 *
 * ※ deleteイベントは各ストリーム（home/local/public/tag）ごとに発火するため、
 *   1つのストリームで受信しただけで全TLから消えないようにする。
 */
export async function handleDeleteEvent(
  backendUrl: string,
  statusId: string,
  sourceTimelineType: TimelineType,
  tag?: string,
): Promise<void> {
  await removeFromTimeline(backendUrl, statusId, sourceTimelineType, tag)
}

/**
 * Statusのアクション状態を更新
 */
export async function updateStatusAction(
  backendUrl: string,
  statusId: string,
  action: 'reblogged' | 'favourited' | 'bookmarked',
  value: boolean,
): Promise<void> {
  const compositeKey = createCompositeKey(backendUrl, statusId)

  await db.transaction('rw', db.statuses, async () => {
    const status = await db.statuses.get(compositeKey)
    if (!status) return

    // メインStatusの更新
    const actionUpdate = {
      [action]: value,
    } as unknown as UpdateSpec<StoredStatus>
    await db.statuses.update(compositeKey, actionUpdate)

    // reblogの場合、reblog元のStatusも更新
    if (status.reblog) {
      const reblogKey = createCompositeKey(backendUrl, status.reblog.id)
      await db.statuses.update(reblogKey, actionUpdate)
    }
  })

  // このStatusをreblogとして持つ他のStatusも更新
  const relatedStatuses = await db.statuses
    .where('[backendUrl+created_at_ms]')
    .between([backendUrl, Dexie.minKey], [backendUrl, Dexie.maxKey])
    .filter((s) => s.reblog?.id === statusId)
    .toArray()

  if (relatedStatuses.length > 0) {
    await db.transaction('rw', db.statuses, async () => {
      for (const related of relatedStatuses) {
        if (related.reblog) {
          await db.statuses.update(related.compositeKey, {
            reblog: { ...related.reblog, [action]: value },
          })
        }
      }
    })
  }
}

/**
 * Status全体を更新（編集された投稿用）
 */
export async function updateStatus(
  status: Entity.Status,
  backendUrl: string,
): Promise<void> {
  const compositeKey = createCompositeKey(backendUrl, status.id)
  const existing = await db.statuses.get(compositeKey)

  if (existing) {
    await db.statuses.update(compositeKey, {
      ...status,
      backendUrl: existing.backendUrl,
      belongingTags: status.tags.map((tag) => tag.name),
      compositeKey: existing.compositeKey,
      created_at_ms: new Date(status.created_at).getTime(),
      storedAt: Date.now(),
      timelineTypes: existing.timelineTypes,
    })
  }
}

/**
 * タイムライン種類でStatusを取得
 *
 * 複合インデックス [backendUrl+created_at_ms] を活用し、
 * DB側でソート済みの結果を返す。
 * created_at_ms は数値型（UnixTime ms）のため、ソート順が確実に時系列となる。
 */
export async function getStatusesByTimelineType(
  timelineType: TimelineType,
  backendUrls?: string[],
  limit?: number,
): Promise<StoredStatus[]> {
  if (backendUrls && backendUrls.length > 0) {
    // 各backendUrl別に複合インデックスで降順取得し、マージする
    const perUrlResults = await Promise.all(
      backendUrls.map((url) =>
        db.statuses
          .where('[backendUrl+created_at_ms]')
          .between([url, Dexie.minKey], [url, Dexie.maxKey])
          .reverse()
          .filter((s) => s.timelineTypes.includes(timelineType))
          .limit(limit ?? Number.MAX_SAFE_INTEGER)
          .toArray(),
      ),
    )
    const merged = perUrlResults.flat()
    return merged
      .sort((a, b) => b.created_at_ms - a.created_at_ms)
      .slice(0, limit)
  }

  // backendUrlsが未指定の場合はmulti-entryインデックスで取得
  const results = await db.statuses
    .where('timelineTypes')
    .equals(timelineType)
    .toArray()

  return results
    .sort((a, b) => b.created_at_ms - a.created_at_ms)
    .slice(0, limit)
}

/**
 * タグでStatusを取得
 *
 * belongingTags の multi-entry インデックスを使用。
 *
 * ## パフォーマンスに関する注記
 *
 * 現在は `where('belongingTags').equals(tag)` で全件取得後、
 * JS側で backendUrl フィルタとソートを行っている。
 * タグタイムラインは通常 home/local と比較して件数が少ないため、
 * この方式で十分なパフォーマンスが得られる想定。
 */
export async function getStatusesByTag(
  tag: string,
  backendUrls?: string[],
  limit?: number,
): Promise<StoredStatus[]> {
  let results = await db.statuses.where('belongingTags').equals(tag).toArray()

  if (backendUrls && backendUrls.length > 0) {
    results = results.filter((s) => backendUrls.includes(s.backendUrl))
  }

  return results
    .sort((a, b) => b.created_at_ms - a.created_at_ms)
    .slice(0, limit)
}
