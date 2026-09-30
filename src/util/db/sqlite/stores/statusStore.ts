/**
 * Status ストア — 書き込み操作・バッファリング
 *
 * 書き込み操作は Worker 側の専用ハンドラに委譲する。
 * 読み取り操作は statusReadStore.ts に分離済み。
 */

import type { Entity } from 'megalodon'
import { getSqliteDb } from '../connection'
import type { TimelineType } from '../queries/statusMapper'
import type { DbHandle } from '../types'

// ================================================================
// ストリーミングイベント マイクロバッチング
// ================================================================

type StatusWriteHandle = Pick<DbHandle, 'sendCommand'>

type BufferedUpsert = {
  status: Entity.Status
  waiters: { reject: (e: unknown) => void; resolve: () => void }[]
}

type UpsertBucket = {
  items: Map<string, BufferedUpsert>
  meta: {
    backendUrl: string
    skipProfileUpdate?: boolean
    tag?: string
    timelineType: TimelineType
  }
}

/** バッファキー: backendUrl + timelineType + tag + skipProfileUpdate */
function makeBufferKey(
  backendUrl: string,
  timelineType: string,
  tag: string | undefined,
  skipProfileUpdate: boolean | undefined,
): string {
  return `${backendUrl}\0${timelineType}\0${tag ?? ''}\0${skipProfileUpdate ? '1' : '0'}`
}

/** バッファリング間隔（ms） */
const FLUSH_INTERVAL_MS = 100
/** この件数に達したら即座にフラッシュ */
const FLUSH_SIZE_THRESHOLD = 20
const MAX_STATUSES_PER_COMMAND = 20

type WriteLaneTask =
  | { buckets: Map<string, UpsertBucket>; kind: 'flush' }
  | {
      kind: 'op'
      reject: (error: unknown) => void
      resolve: () => void
      run: (handle: StatusWriteHandle) => Promise<unknown>
    }

export function createStatusWriteStore(
  getHandle: () => Promise<StatusWriteHandle>,
) {
  let pendingBuckets = new Map<string, UpsertBucket>()
  const queuedBuckets = new WeakSet<Map<string, UpsertBucket>>()
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  const lane: WriteLaneTask[] = []
  let laneRunning = false

  function bufferedItemCount(): number {
    let count = 0
    for (const bucket of pendingBuckets.values()) {
      count += bucket.items.size
    }
    return count
  }

  function pumpLane(): void {
    if (laneRunning) return
    laneRunning = true
    void runLane().finally(() => {
      laneRunning = false
      if (lane.length > 0) pumpLane()
    })
  }

  async function runLane(): Promise<void> {
    while (lane.length > 0) {
      const task = lane.shift() as WriteLaneTask
      try {
        const handle = await getHandle()
        if (task.kind === 'flush') {
          await flushBuckets(handle, task.buckets)
        } else {
          await task.run(handle)
          task.resolve()
        }
      } catch (error) {
        if (task.kind === 'flush') {
          console.error('Failed to flush upsert buffer:', error)
          for (const bucket of task.buckets.values()) {
            for (const item of bucket.items.values()) {
              for (const waiter of item.waiters) waiter.reject(error)
            }
            bucket.items.clear()
          }
          task.buckets.clear()
        } else {
          task.reject(error)
        }
      }
      if (task.kind === 'flush') {
        queuedBuckets.delete(task.buckets)
      }
    }
  }

  async function flushBuckets(
    handle: StatusWriteHandle,
    buckets: Map<string, UpsertBucket>,
  ): Promise<void> {
    for (;;) {
      const first = buckets.entries().next().value
      if (!first) break
      const [key, bucket] = first
      buckets.delete(key)
      if (bucket.items.size === 0) continue
      buckets.set(key, bucket)

      const batch: BufferedUpsert[] = []
      for (const [id, item] of bucket.items) {
        batch.push(item)
        bucket.items.delete(id)
        if (batch.length >= MAX_STATUSES_PER_COMMAND) break
      }

      try {
        await handle.sendCommand({
          backendUrl: bucket.meta.backendUrl,
          skipProfileUpdate: bucket.meta.skipProfileUpdate,
          statusesJson: batch.map((item) => JSON.stringify(item.status)),
          tag: bucket.meta.tag,
          timelineType: bucket.meta.timelineType,
          type: 'bulkUpsertStatuses',
        })
        for (const item of batch) {
          for (const waiter of item.waiters) waiter.resolve()
        }
      } catch (error) {
        console.error('Failed to flush upsert buffer:', error)
        for (const item of batch) {
          for (const waiter of item.waiters) waiter.reject(error)
        }
      }
    }
  }

  function ensureBucketsQueued(): void {
    if (pendingBuckets.size === 0) return
    if (queuedBuckets.has(pendingBuckets)) return
    queuedBuckets.add(pendingBuckets)
    lane.push({ buckets: pendingBuckets, kind: 'flush' })
    pumpLane()
  }

  function scheduleFlush(): void {
    // 閾値に達したら即座にフラッシュ
    if (bufferedItemCount() >= FLUSH_SIZE_THRESHOLD) {
      if (flushTimer !== null) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      ensureBucketsQueued()
      return
    }
    // タイマーが未設定なら設定
    flushTimer ??= setTimeout(() => {
      flushTimer = null
      ensureBucketsQueued()
    }, FLUSH_INTERVAL_MS)
  }

  function enqueueOperation(
    run: (handle: StatusWriteHandle) => Promise<unknown>,
  ): Promise<void> {
    ensureBucketsQueued()
    pendingBuckets = new Map()
    return new Promise<void>((resolve, reject) => {
      lane.push({ kind: 'op', reject, resolve, run })
      pumpLane()
    })
  }

  function enqueueUpsert(
    status: Entity.Status,
    backendUrl: string,
    timelineType: TimelineType,
    tag: string | undefined,
    skipProfileUpdate: boolean | undefined,
  ): Promise<void> {
    const key = makeBufferKey(backendUrl, timelineType, tag, skipProfileUpdate)
    let bucket = pendingBuckets.get(key)
    if (!bucket) {
      bucket = {
        items: new Map(),
        meta: { backendUrl, skipProfileUpdate, tag, timelineType },
      }
      pendingBuckets.set(key, bucket)
    }
    return new Promise<void>((resolve, reject) => {
      const bucketRef = bucket as UpsertBucket
      const existing = bucketRef.items.get(status.id)
      const waiters = existing?.waiters ?? []
      waiters.push({ reject, resolve })
      bucketRef.items.set(status.id, { status, waiters })
      scheduleFlush()
    })
  }

  /**
   * Status を追加または更新（マイクロバッチング対応）
   *
   * ストリーミングイベントごとの個別トランザクションを避けるため、
   * バッファに蓄積し一定間隔または閾値到達時にまとめてフラッシュする。
   */
  function upsertStatus(
    status: Entity.Status,
    backendUrl: string,
    timelineType: TimelineType,
    tag?: string,
  ): Promise<void> {
    return enqueueUpsert(status, backendUrl, timelineType, tag, undefined)
  }

  /**
   * 複数の Status を一括追加（初期ロード用）
   */
  async function bulkUpsertStatuses(
    statuses: Entity.Status[],
    backendUrl: string,
    timelineType: TimelineType,
    tag?: string,
    skipProfileUpdate?: boolean,
  ): Promise<void> {
    if (statuses.length === 0) return
    await Promise.all(
      statuses.map((status) =>
        enqueueUpsert(status, backendUrl, timelineType, tag, skipProfileUpdate),
      ),
    )
  }

  /**
   * 特定タイムラインから Status を除外（物理削除ではない）
   */
  function removeFromTimeline(
    backendUrl: string,
    statusId: string,
    timelineType: TimelineType,
    tag?: string,
  ): Promise<void> {
    return enqueueOperation(async (handle) => {
      await handle.sendCommand({
        backendUrl,
        statusId,
        tag,
        timelineType,
        type: 'removeFromTimeline',
      })
    })
  }

  /**
   * delete イベントの処理
   */
  function handleDeleteEvent(
    backendUrl: string,
    statusId: string,
    sourceTimelineType: TimelineType,
    tag?: string,
  ): Promise<void> {
    return enqueueOperation(async (handle) => {
      await handle.sendCommand({
        backendUrl,
        sourceTimelineType,
        statusId,
        tag,
        type: 'handleDeleteEvent',
      })
    })
  }

  /**
   * Status のアクション状態を更新
   */
  function updateStatusAction(
    backendUrl: string,
    statusId: string,
    action: 'reblogged' | 'favourited' | 'bookmarked',
    value: boolean,
  ): Promise<void> {
    return enqueueOperation(async (handle) => {
      await handle.sendCommand({
        action,
        backendUrl,
        statusId,
        type: 'updateStatusAction',
        value,
      })
    })
  }

  /**
   * Status 全体を更新（編集された投稿用）
   */
  function updateStatus(
    status: Entity.Status,
    backendUrl: string,
  ): Promise<void> {
    return enqueueOperation(async (handle) => {
      await handle.sendCommand({
        backendUrl,
        statusJson: JSON.stringify(status),
        type: 'updateStatus',
      })
    })
  }

  /**
   * ローカルアカウントを登録または更新
   *
   * verifyAccountCredentials で取得した自アカウント情報を local_accounts テーブルに反映する。
   */
  async function ensureLocalAccount(
    account: Entity.Account,
    backendUrl: string,
  ): Promise<void> {
    const handle = await getHandle()
    await handle.sendCommand({
      accountJson: JSON.stringify(account),
      backendUrl,
      type: 'ensureLocalAccount',
    })
  }

  /**
   * リアクションの追加/削除を DB に反映する
   */
  function toggleReactionInDb(
    backendUrl: string,
    statusId: string,
    value: boolean,
    emoji: string,
  ): Promise<void> {
    return enqueueOperation(async (handle) => {
      await handle.sendCommand({
        backendUrl,
        emoji,
        statusId,
        type: 'toggleReaction',
        value,
      })
    })
  }

  /**
   * カスタム絵文字カタログを DB に一括登録する
   *
   * ResourceProvider が getInstanceCustomEmojis() で取得した絵文字一覧を
   * custom_emojis テーブルに UPSERT し、ストリーミング時のフォールバック解決に備える。
   */
  async function bulkUpsertCustomEmojis(
    backendUrl: string,
    emojis: { shortcode: string; url: string; static_url: string }[],
  ): Promise<void> {
    if (emojis.length === 0) return
    const handle = await getHandle()
    await handle.sendCommand({
      backendUrl,
      emojisJson: JSON.stringify(emojis),
      type: 'bulkUpsertCustomEmojis',
    })
  }

  return {
    bulkUpsertCustomEmojis,
    bulkUpsertStatuses,
    ensureLocalAccount,
    handleDeleteEvent,
    removeFromTimeline,
    toggleReactionInDb,
    updateStatus,
    updateStatusAction,
    upsertStatus,
  }
}

const defaultStatusWriteStore = createStatusWriteStore(getSqliteDb)

export const bulkUpsertCustomEmojis =
  defaultStatusWriteStore.bulkUpsertCustomEmojis
export const bulkUpsertStatuses = defaultStatusWriteStore.bulkUpsertStatuses
export const ensureLocalAccount = defaultStatusWriteStore.ensureLocalAccount
export const handleDeleteEvent = defaultStatusWriteStore.handleDeleteEvent
export const removeFromTimeline = defaultStatusWriteStore.removeFromTimeline
export const toggleReactionInDb = defaultStatusWriteStore.toggleReactionInDb
export const updateStatus = defaultStatusWriteStore.updateStatus
export const updateStatusAction = defaultStatusWriteStore.updateStatusAction
export const upsertStatus = defaultStatusWriteStore.upsertStatus
