/**
 * DB 操作キューシステム
 *
 * タイムライン取得(timeline)キューとそれ以外(other)キューを提供し、
 * other キューを優先して処理する。
 * timeline キューは同じクエリ(SQL + bind + returnValue)が未処理なら新しく積まない。
 * キューの変化をスナップショットとして記録し、グラフ表示に利用する。
 */

// ================================================================
// 型定義
// ================================================================

export type QueueKind = 'other' | 'timeline'

/** スナップショット1件 */
export type QueueSnapshot = {
  /** 記録時刻 (performance.now()) */
  time: number
  /** 未完了の other リクエスト数 (キュー待機中 + 実行中) */
  other: number
  /** 未完了のタイムライン取得リクエスト数 (キュー待機中 + 実行中) */
  timeline: number
  /** 処理完了した other 数の累計 */
  otherProcessed: number
  /** 処理完了したタイムライン取得数の累計 */
  timelineProcessed: number
}

/** キュー変更リスナー */
type QueueChangeListener = () => void

// ================================================================
// 定数
// ================================================================

/** スナップショットの最大保持数 */
const MAX_SNAPSHOTS = 200

/** スナップショット記録間隔 (ms) */
const SNAPSHOT_INTERVAL_MS = 500

// ================================================================
// 内部状態
// ================================================================

/** スナップショット履歴 (循環バッファ) */
const snapshots: QueueSnapshot[] = []

/** other キューの現在サイズ */
let otherQueueSize = 0

/** タイムライン取得キューの現在サイズ */
let timelineQueueSize = 0

/** 処理済み other 数（累計） */
let otherProcessedTotal = 0

/** 処理済みタイムライン取得数（累計） */
let timelineProcessedTotal = 0

/** 定期スナップショットタイマー */
let snapshotTimerId: ReturnType<typeof setInterval> | null = null

/** 変更リスナー */
const listeners = new Set<QueueChangeListener>()

// ================================================================
// スナップショット管理
// ================================================================

function recordSnapshot(): void {
  const snapshot: QueueSnapshot = {
    other: otherQueueSize,
    otherProcessed: otherProcessedTotal,
    time: performance.now(),
    timeline: timelineQueueSize,
    timelineProcessed: timelineProcessedTotal,
  }
  snapshots.push(snapshot)
  if (snapshots.length > MAX_SNAPSHOTS) {
    snapshots.shift()
  }
}

function notifyListeners(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch (e) {
      console.error('QueueStats listener error:', e)
    }
  }
}

/**
 * 定期スナップショット記録を開始する。
 * 2回目以降の呼び出しは無視する。
 */
export function startSnapshotRecording(): void {
  if (snapshotTimerId != null) return
  // 初回スナップショットを即座に記録
  recordSnapshot()
  snapshotTimerId = setInterval(() => {
    recordSnapshot()
    notifyListeners()
  }, SNAPSHOT_INTERVAL_MS)
}

/**
 * 定期スナップショット記録を停止する。
 */
export function stopSnapshotRecording(): void {
  if (snapshotTimerId != null) {
    clearInterval(snapshotTimerId)
    snapshotTimerId = null
  }
}

// ================================================================
// キューサイズ更新 API (workerClient から呼ばれる)
// ================================================================

/**
 * キューにアイテムが追加されたときに呼ぶ。
 */
export function reportEnqueue(kind: QueueKind): void {
  if (kind === 'other') {
    otherQueueSize++
  } else {
    timelineQueueSize++
  }
}

/**
 * キューからアイテムが処理完了したときに呼ぶ。
 */
export function reportDequeue(kind: QueueKind): void {
  if (kind === 'other') {
    otherQueueSize = Math.max(0, otherQueueSize - 1)
    otherProcessedTotal++
  } else {
    timelineQueueSize = Math.max(0, timelineQueueSize - 1)
    timelineProcessedTotal++
  }
}

// ================================================================
// 読み取り API
// ================================================================

/**
 * スナップショット履歴を返す（直近 MAX_SNAPSHOTS 件）。
 * 呼び出し側から内部配列を破壊的変更できないよう、shallow copy を返す。
 */
export function getSnapshots(): readonly QueueSnapshot[] {
  return snapshots.slice()
}

/**
 * 現在のキューサイズを返す。
 */
export function getCurrentQueueSizes(): { other: number; timeline: number } {
  return { other: otherQueueSize, timeline: timelineQueueSize }
}

// ================================================================
// リスナー管理
// ================================================================

/**
 * キュー状態変更リスナーを登録する。
 * 戻り値は unsubscribe 関数。
 */
export function subscribeQueueStats(fn: QueueChangeListener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
