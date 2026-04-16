/**
 * DB 操作キューシステム
 *
 * タイムライン取得(timeline)キューとそれ以外(other)キューを提供し、
 * other キューを優先して処理する。
 * timeline キューは同じクエリ(SQL + bind + returnValue)が未処理なら新しく積まない。
 * キューの変化をスナップショットとして記録し、グラフ表示に利用する。
 *
 * 処理優先度はプリセットで動的に変更可能。
 * - auto:         キュー状態に応じて自動調整 (デフォルト)
 * - balanced:     タイムライン更新を重視 (maxConsecutiveOther = 2)
 * - default:      標準バランス             (maxConsecutiveOther = 4)
 * - other-first:  書き込み・管理操作優先   (maxConsecutiveOther = 8)
 *
 * auto モードでは両キューの待機数比率から maxConsecutiveOther を算出する。
 *
 * | other/timeline 比率 | maxConsecutiveOther | 狙い                         |
 * |---------------------|---------------------|------------------------------|
 * | ≥ 3.0               | 8                   | other を集中処理して解消      |
 * | ≥ 1.5               | 6                   | other 寄り                   |
 * | 0.67 – 1.5          | 4                   | 従来どおり                   |
 * | ≥ 0.33              | 2                   | timeline に頻繁に譲る        |
 * | < 0.33              | 1                   | ほぼ交互処理                 |
 */

// ================================================================
// 型定義
// ================================================================

export type QueueKind = 'other' | 'timeline'

/** キュー処理優先度プリセット名 */
export type QueuePriorityPreset =
  | 'auto'
  | 'balanced'
  | 'default'
  | 'other-first'

/** キュー処理優先度の設定値 */
export type QueuePriorityConfig = {
  /** プリセット名 */
  preset: QueuePriorityPreset
  /** other キューを連続処理する最大回数 (auto の場合は直近の算出値) */
  maxConsecutiveOther: number
}

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
  /** スナップショット記録時点の maxConsecutiveOther 値 */
  maxConsecutiveOther: number
  /** 直近の timeline キューの平均待機時間 (ms)。データなしの場合は 0 */
  avgWaitMs: number
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

/**
 * タイムラインキューの最大サイズ。
 * これを超えると最古のリクエストを破棄して新しいリクエストを受け付ける。
 * タイムライン数 5〜10 × 2 程度を想定。
 */
export const MAX_TIMELINE_QUEUE_SIZE = 20

/**
 * キュー飽和と判定する timeline キューサイズの閾値。
 * この値以上のとき debounce を延長する。
 */
export const QUEUE_SATURATED_THRESHOLD = 15

/** 固定プリセットごとの maxConsecutiveOther 定義 */
const FIXED_PRESETS: Record<Exclude<QueuePriorityPreset, 'auto'>, number> = {
  balanced: 2,
  default: 4,
  'other-first': 8,
}

/**
 * auto モードの適応テーブル。
 * other/timeline 比率の閾値 (降順) と対応する maxConsecutiveOther。
 * 上から順に評価し、最初にマッチしたものを採用する。
 */
const ADAPTIVE_TABLE: readonly { minRatio: number; value: number }[] = [
  { minRatio: 3.0, value: 8 },
  { minRatio: 1.5, value: 6 },
  { minRatio: 0.67, value: 4 },
  { minRatio: 0.33, value: 2 },
]

/** adaptive テーブルのどの閾値にもマッチしなかった場合のフォールバック */
const ADAPTIVE_FLOOR = 1

/** auto モードでキューサイズ不明時のデフォルト値 */
const ADAPTIVE_DEFAULT = 4

// ================================================================
// 内部状態
// ================================================================

/** スナップショット履歴 (循環バッファ) */
const snapshots: QueueSnapshot[] = []

/** other キューの現在サイズ */
let otherQueueSize = 0

/** other キューに一度でもアイテムが入ったか */
let otherHasBeenNonZero = false

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

/** 現在の優先度プリセット */
let currentPriorityPreset: QueuePriorityPreset = 'auto'

// ---- timeline キュー待機時間トラッキング ----

/** timeline キューの直近待機時間バッファ (ms) — 循環バッファ */
const WAIT_TIME_BUFFER_SIZE = 50
const waitTimeBuffer: number[] = []

/** 前回の飽和警告ログの時刻 (performance.now()) — スロットリング用 */
let lastSaturationLogTime = 0

/** 飽和警告ログのスロットリング間隔 (ms) */
const SATURATION_LOG_INTERVAL_MS = 5_000

/** 直近の auto 算出値 (スナップショット記録・getQueuePriority 用) */
let lastAutoValue: number = ADAPTIVE_DEFAULT

// ================================================================
// 適応アルゴリズム
// ================================================================

/**
 * 両キューの待機数から maxConsecutiveOther を算出する。
 *
 * - timeline が空 → other を最大限連続処理 (8)
 * - other が空    → 値は使われないがデフォルト (4) を返す
 * - 両方にアイテムがある場合は比率テーブルで決定
 */
function computeAdaptiveMax(otherLen: number, timelineLen: number): number {
  if (timelineLen === 0) return 8
  if (otherLen === 0) return ADAPTIVE_DEFAULT

  const ratio = otherLen / timelineLen
  for (const { minRatio, value } of ADAPTIVE_TABLE) {
    if (ratio >= minRatio) return value
  }
  return ADAPTIVE_FLOOR
}

// ================================================================
// スナップショット管理
// ================================================================

/**
 * 直近の timeline キューの平均待機時間を算出する。
 */
function computeAvgWaitMs(): number {
  if (waitTimeBuffer.length === 0) return 0
  let sum = 0
  for (const ms of waitTimeBuffer) sum += ms
  return Math.round(sum / waitTimeBuffer.length)
}

/**
 * timeline キューの待機時間を記録する。
 * 循環バッファに追加し、古いエントリを自動的に押し出す。
 */
export function recordWaitTime(ms: number): void {
  waitTimeBuffer.push(ms)
  if (waitTimeBuffer.length > WAIT_TIME_BUFFER_SIZE) {
    waitTimeBuffer.shift()
  }
}

function recordSnapshot(): void {
  const avgWaitMs = computeAvgWaitMs()
  const snapshot: QueueSnapshot = {
    avgWaitMs,
    maxConsecutiveOther:
      currentPriorityPreset === 'auto'
        ? lastAutoValue
        : FIXED_PRESETS[currentPriorityPreset],
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

  // 飽和状態の警告ログ（スロットリング付き）
  if (timelineQueueSize >= QUEUE_SATURATED_THRESHOLD) {
    const now = performance.now()
    if (now - lastSaturationLogTime >= SATURATION_LOG_INTERVAL_MS) {
      lastSaturationLogTime = now
      console.warn(
        `[dbQueue] Timeline queue saturated: size=${timelineQueueSize}, avgWaitMs=${avgWaitMs}`,
      )
    }
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
    if (!otherHasBeenNonZero) {
      otherHasBeenNonZero = true
      notifyListeners()
    }
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
    if (otherQueueSize === 0) {
      notifyListeners()
    }
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

/**
 * 現在の優先度設定を返す。
 * auto モードの場合、maxConsecutiveOther は直近の算出値を返す。
 */
export function getQueuePriority(): QueuePriorityConfig {
  if (currentPriorityPreset === 'auto') {
    return {
      maxConsecutiveOther: lastAutoValue,
      preset: 'auto',
    }
  }
  return {
    maxConsecutiveOther: FIXED_PRESETS[currentPriorityPreset],
    preset: currentPriorityPreset,
  }
}

/**
 * 優先度プリセットを変更する。
 * 変更は次回の processQueue 呼び出しから即座に反映される。
 */
export function setQueuePriority(preset: QueuePriorityPreset): void {
  currentPriorityPreset = preset
  notifyListeners()
}

/**
 * 現在の maxConsecutiveOther 値を返す。
 * workerClient の processQueue から呼ばれる。
 *
 * auto モードの場合、実際のキュー待機数を渡して適応値を算出する。
 * 固定プリセットの場合、引数は無視してプリセット値を返す。
 *
 * @param otherQueueLen  - other キューの現在の待機数
 * @param timelineQueueLen - timeline キューの現在の待機数
 */
export function getMaxConsecutiveOther(
  otherQueueLen: number,
  timelineQueueLen: number,
): number {
  if (currentPriorityPreset !== 'auto') {
    return FIXED_PRESETS[currentPriorityPreset]
  }
  const value = computeAdaptiveMax(otherQueueLen, timelineQueueLen)
  lastAutoValue = value
  return value
}

/**
 * Other キューに一度でもアイテムが追加されたことがあるかを返す。
 * 初回チェックでキューが空のときに「まだ開始されていない」と判定するために使用する。
 */
export function hasOtherQueueBeenActive(): boolean {
  return otherHasBeenNonZero
}

/**
 * timeline キューが飽和状態かどうかを返す。
 * connection.ts の動的 debounce 調整に使用する。
 */
export function isTimelineQueueSaturated(): boolean {
  return timelineQueueSize >= QUEUE_SATURATED_THRESHOLD
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
