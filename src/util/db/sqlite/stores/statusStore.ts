/**
 * Status ストア — 書き込み操作・バッファリング
 *
 * 書き込み操作は Worker 側の専用ハンドラに委譲する。
 * 読み取り操作は statusReadStore.ts に分離済み。
 */

import type { Entity } from 'megalodon'
import { getSqliteDb } from '../connection'
import type { TimelineType } from '../queries/statusMapper'

// ================================================================
// ストリーミングイベント マイクロバッチング
// ================================================================

type BufferedUpsert = {
  backendUrl: string
  status: Entity.Status
  tag?: string
  timelineType: TimelineType
}

/** バッファキー: backendUrl + timelineType + tag */
function makeBufferKey(
  backendUrl: string,
  timelineType: string,
  tag?: string,
): string {
  return `${backendUrl}\0${timelineType}\0${tag ?? ''}`
}

const upsertBufferMap = new Map<string, BufferedUpsert[]>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

/** バッファリング間隔（ms） */
const FLUSH_INTERVAL_MS = 100
/** この件数に達したら即座にフラッシュ */
const FLUSH_SIZE_THRESHOLD = 20

async function flushAllBuffers(): Promise<void> {
  flushTimer = null
  const entries = Array.from(upsertBufferMap.entries())
  upsertBufferMap.clear()

  for (const [, items] of entries) {
    if (items.length === 0) continue
    const { backendUrl, tag, timelineType } = items[0]
    try {
      const handle = await getSqliteDb()
      await handle.sendCommand({
        backendUrl,
        statusesJson: items.map((e) => JSON.stringify(e.status)),
        tag,
        timelineType,
        type: 'bulkUpsertStatuses',
      })
    } catch (error) {
      console.error('Failed to flush upsert buffer:', error)
    }
  }
}

/**
 * Status を追加または更新（マイクロバッチング対応）
 *
 * ストリーミングイベントごとの個別トランザクションを避けるため、
 * バッファに蓄積し一定間隔または閾値到達時にまとめてフラッシュする。
 */
export async function upsertStatus(
  status: Entity.Status,
  backendUrl: string,
  timelineType: TimelineType,
  tag?: string,
): Promise<void> {
  const key = makeBufferKey(backendUrl, timelineType, tag)
  let buf = upsertBufferMap.get(key)
  if (!buf) {
    buf = []
    upsertBufferMap.set(key, buf)
  }
  buf.push({ backendUrl, status, tag, timelineType })

  // 閾値に達したら即座にフラッシュ
  const totalBuffered = Array.from(upsertBufferMap.values()).reduce(
    (sum, b) => sum + b.length,
    0,
  )
  if (totalBuffered >= FLUSH_SIZE_THRESHOLD) {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
    }
    await flushAllBuffers()
    return
  }

  // タイマーが未設定なら設定
  if (flushTimer === null) {
    flushTimer = setTimeout(() => {
      flushAllBuffers()
    }, FLUSH_INTERVAL_MS)
  }
}

/**
 * 複数の Status を一括追加（初期ロード用）
 */
export async function bulkUpsertStatuses(
  statuses: Entity.Status[],
  backendUrl: string,
  timelineType: TimelineType,
  tag?: string,
  skipProfileUpdate?: boolean,
): Promise<void> {
  if (statuses.length === 0) return

  const handle = await getSqliteDb()
  await handle.sendCommand({
    backendUrl,
    skipProfileUpdate,
    statusesJson: statuses.map((s) => JSON.stringify(s)),
    tag,
    timelineType,
    type: 'bulkUpsertStatuses',
  })
}

/**
 * 特定タイムラインから Status を除外（物理削除ではない）
 */
export async function removeFromTimeline(
  backendUrl: string,
  statusId: string,
  timelineType: TimelineType,
  tag?: string,
): Promise<void> {
  const handle = await getSqliteDb()
  await handle.sendCommand({
    backendUrl,
    statusId,
    tag,
    timelineType,
    type: 'removeFromTimeline',
  })
}

/**
 * delete イベントの処理
 */
export async function handleDeleteEvent(
  backendUrl: string,
  statusId: string,
  sourceTimelineType: TimelineType,
  tag?: string,
): Promise<void> {
  const handle = await getSqliteDb()
  await handle.sendCommand({
    backendUrl,
    sourceTimelineType,
    statusId,
    tag,
    type: 'handleDeleteEvent',
  })
}

/**
 * Status のアクション状態を更新
 */
export async function updateStatusAction(
  backendUrl: string,
  statusId: string,
  action: 'reblogged' | 'favourited' | 'bookmarked',
  value: boolean,
): Promise<void> {
  const handle = await getSqliteDb()
  await handle.sendCommand({
    action,
    backendUrl,
    statusId,
    type: 'updateStatusAction',
    value,
  })
}

/**
 * Status 全体を更新（編集された投稿用）
 */
export async function updateStatus(
  status: Entity.Status,
  backendUrl: string,
): Promise<void> {
  const handle = await getSqliteDb()
  await handle.sendCommand({
    backendUrl,
    statusJson: JSON.stringify(status),
    type: 'updateStatus',
  })
}

/**
 * ローカルアカウントを登録または更新
 *
 * verifyAccountCredentials で取得した自アカウント情報を local_accounts テーブルに反映する。
 */
export async function ensureLocalAccount(
  account: Entity.Account,
  backendUrl: string,
): Promise<void> {
  const handle = await getSqliteDb()
  await handle.sendCommand({
    accountJson: JSON.stringify(account),
    backendUrl,
    type: 'ensureLocalAccount',
  })
}

/**
 * リアクションの追加/削除を DB に反映する
 */
export async function toggleReactionInDb(
  backendUrl: string,
  statusId: string,
  value: boolean,
  emoji: string,
): Promise<void> {
  const handle = await getSqliteDb()
  await handle.sendCommand({
    backendUrl,
    emoji,
    statusId,
    type: 'toggleReaction',
    value,
  })
}

/**
 * カスタム絵文字カタログを DB に一括登録する
 *
 * ResourceProvider が getInstanceCustomEmojis() で取得した絵文字一覧を
 * custom_emojis テーブルに UPSERT し、ストリーミング時のフォールバック解決に備える。
 */
export async function bulkUpsertCustomEmojis(
  backendUrl: string,
  emojis: { shortcode: string; url: string; static_url: string }[],
): Promise<void> {
  if (emojis.length === 0) return
  const handle = await getSqliteDb()
  await handle.sendCommand({
    backendUrl,
    emojisJson: JSON.stringify(emojis),
    type: 'bulkUpsertCustomEmojis',
  })
}
