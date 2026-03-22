/**
 * DB 操作キューシステム
 *
 * 書き込み(write)キューと読み込み(read)キューを提供し、
 * 書き込みキューを優先して処理する。
 * 読み込みキューは同じクエリ(SQL + bind)が未処理なら新しく積まない。
 * キューの変化をスナップショットとして記録し、グラフ表示に利用する。
 */

// ================================================================
// 型定義
// ================================================================

export type QueueKind = 'read' | 'write'

/** スナップショット1件 */
export type QueueSnapshot = {
  /** 記録時刻 (performance.now()) */
  time: number
  /** 書き込みキュー内アイテム数 */
  write: number
  /** 読み込みキュー内アイテム数 */
  read: number
  /** 処理完了した書き込み数の累計 */
  writeProcessed: number
  /** 処理完了した読み込み数の累計 */
  readProcessed: number
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

/** 書き込みキューの現在サイズ */
let writeQueueSize = 0

/** 読み込みキューの現在サイズ */
let readQueueSize = 0

/** 処理済み書き込み数（累計） */
let writeProcessedTotal = 0

/** 処理済み読み込み数（累計） */
let readProcessedTotal = 0

/** 定期スナップショットタイマー */
let snapshotTimerId: ReturnType<typeof setInterval> | null = null

/** 変更リスナー */
const listeners = new Set<QueueChangeListener>()

// ================================================================
// スナップショット管理
// ================================================================

function recordSnapshot(): void {
  const snapshot: QueueSnapshot = {
    read: readQueueSize,
    readProcessed: readProcessedTotal,
    time: performance.now(),
    write: writeQueueSize,
    writeProcessed: writeProcessedTotal,
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
  if (kind === 'write') {
    writeQueueSize++
  } else {
    readQueueSize++
  }
}

/**
 * キューからアイテムが処理完了したときに呼ぶ。
 */
export function reportDequeue(kind: QueueKind): void {
  if (kind === 'write') {
    writeQueueSize = Math.max(0, writeQueueSize - 1)
    writeProcessedTotal++
  } else {
    readQueueSize = Math.max(0, readQueueSize - 1)
    readProcessedTotal++
  }
}

/**
 * 読み込みキューで重複が検出されスキップされたときに呼ぶ。
 * (キューサイズは増えないが、処理済みカウントは増やさない)
 */
export function reportReadDeduplicated(): void {
  // サイズは変わらない（そもそも追加されていない）
  // 特にカウントする必要はないが、リスナー通知のため存在
}

// ================================================================
// 読み取り API
// ================================================================

/**
 * スナップショット履歴を返す（直近 MAX_SNAPSHOTS 件）。
 */
export function getSnapshots(): readonly QueueSnapshot[] {
  return snapshots
}

/**
 * 現在のキューサイズを返す。
 */
export function getCurrentQueueSizes(): { read: number; write: number } {
  return { read: readQueueSize, write: writeQueueSize }
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
