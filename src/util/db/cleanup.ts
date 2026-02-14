import { MAX_LENGTH } from 'util/environment'
import { db, type TimelineType } from './database'

const TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7日

/**
 * 古いデータをクリーンアップ（TTLベース）
 */
export async function cleanupOldData(): Promise<void> {
  const threshold = Date.now() - TTL_MS

  await db.transaction('rw', [db.statuses, db.notifications], async () => {
    await db.statuses.where('storedAt').below(threshold).delete()
    await db.notifications.where('storedAt').below(threshold).delete()
  })
}

/**
 * MAX_LENGTHを超えるデータを削除（タイムライン種類ごと）
 *
 * ## 責務と実行タイミング
 * - **実行場所**: cleanup.ts の `enforceMaxLength()` が一元的に担当
 * - **実行タイミング**: `startPeriodicCleanup()` により以下のタイミングで実行
 *   1. アプリ起動時（初回実行）
 *   2. 1時間ごとの定期実行
 * - **呼び出し元**: `StatusStoreProvider` の `useEffect` 内で `startPeriodicCleanup()` を呼び出す
 *
 * ## 削除ロジック
 * - 各タイムライン種別ごとに MAX_LENGTH を超える古い投稿を特定
 * - 対象の投稿が他のタイムラインにも属している場合は、当該タイムラインからのみ除外
 * - どのタイムラインにも属さなくなった場合のみ物理削除
 *
 * ## ソート順
 * - `created_at_ms`（数値型 UnixTime ms）でソートする
 * - 文字列の `created_at` ではなく数値型を使用することで、ソート順が確実に時系列となる
 */
export async function enforceMaxLength(): Promise<void> {
  const timelineTypes: TimelineType[] = ['home', 'local', 'public', 'tag']

  for (const type of timelineTypes) {
    const statuses = await db.statuses
      .where('timelineTypes')
      .equals(type)
      .sortBy('created_at_ms')

    if (statuses.length > MAX_LENGTH) {
      const toDelete = statuses.slice(0, statuses.length - MAX_LENGTH)

      await db.transaction('rw', db.statuses, async () => {
        for (const status of toDelete) {
          const updatedTimelineTypes = status.timelineTypes.filter(
            (t) => t !== type,
          )

          if (updatedTimelineTypes.length === 0) {
            // どのタイムラインにも属さなくなったら物理削除
            await db.statuses.delete(status.compositeKey)
          } else {
            // 他のタイムラインに属している場合はTL種別のみ除外
            await db.statuses.update(status.compositeKey, {
              timelineTypes: updatedTimelineTypes,
            })
          }
        }
      })
    }
  }

  // notifications の MAX_LENGTH 制限
  const notifications = await db.notifications
    .toCollection()
    .sortBy('created_at_ms')
  if (notifications.length > MAX_LENGTH) {
    const toDelete = notifications.slice(0, notifications.length - MAX_LENGTH)
    const keys = toDelete.map((n) => n.compositeKey)
    await db.transaction('rw', db.notifications, async () => {
      for (const key of keys) {
        await db.notifications.delete(key)
      }
    })
  }
}

/**
 * 定期クリーンアップの開始
 *
 * StatusStoreProvider の useEffect 内で呼び出す。
 * 返却されるクリーンアップ関数を useEffect のクリーンアップで実行すること。
 */
export function startPeriodicCleanup(): () => void {
  // 初回実行
  cleanupOldData()
  enforceMaxLength()

  // 1時間ごとに実行
  const intervalId = setInterval(
    () => {
      cleanupOldData()
      enforceMaxLength()
    },
    60 * 60 * 1000,
  )

  // クリーンアップ関数を返す
  return () => clearInterval(intervalId)
}
