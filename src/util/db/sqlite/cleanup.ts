/**
 * SQLite ベースのクリーンアップ
 *
 * MAX_LENGTH を超えるデータを削除する。TTL は設けない。
 *
 * 本ファイルの機能:
 *   - enforceMaxLength: Worker に 1 バッチずつ削除を委譲し、hasMore が false になるまで繰り返す。
 *   - startPeriodicCleanup: 10 分周期の定期クリーンアップ。失敗時は 1 分後に最大 3 回再試行。
 *   - watchQueueSaturation: timeline キューが連続 5 秒以上飽和したら緊急クリーンアップを発火。
 *     grace 30s / cooldown 60s / targetRatio=0.5 の条件で削減する。
 *     priority キューに投入するため他の書き込み処理より優先して実行される。
 */

import { isTimelineQueueSaturated } from '../dbQueue'
import { getSqliteDb } from './connection'

// ================================================================
// 定数
// ================================================================

/** 初回定期クリーンアップの遅延: 起動直後の Worker ブロッキングを回避 */
const INITIAL_DELAY_MS = 120_000

/** 定期クリーンアップ周期 (10 分) */
const PERIODIC_INTERVAL_MS = 10 * 60 * 1000

/** 定期クリーンアップ失敗時のリトライ間隔 (1 分) */
const RETRY_DELAY_MS = 60 * 1000

/** 定期クリーンアップの連続失敗許容回数（これを超えると次の周期まで待つ） */
const MAX_CONSECUTIVE_FAILURES = 3

/** 緊急クリーンアップの飽和監視ティック間隔 */
const SATURATION_TICK_MS = 1_000

/** この期間連続で飽和が続いた場合に緊急クリーンアップを発火 */
const SATURATION_DURATION_MS = 5_000

/** 起動からこの期間は緊急クリーンアップを抑制 (リロード直後のキュー積み上がり対策) */
const INITIAL_GRACE_MS = 30_000

/** 緊急クリーンアップ完了後のクールダウン */
const EMERGENCY_COOLDOWN_MS = 60_000

/** 緊急クリーンアップで各グループに残す割合 */
const EMERGENCY_TARGET_RATIO = 0.5

/** バッチループが無限に回ることを防ぐ安全上限 */
const MAX_BATCH_ITERATIONS = 100

// ================================================================
// 型
// ================================================================

type EnforceMaxLengthOptions = {
  mode?: 'periodic' | 'emergency'
  targetRatio?: number
  /** Worker キューの振り分け (default 'other'; 緊急時は 'priority') */
  kind?: 'priority' | 'other'
}

type EnforceMaxLengthResponse = {
  hasMore?: boolean
  deletedCounts?: {
    timeline_entries: number
    notifications: number
    posts: number
  }
}

// ================================================================
// enforceMaxLength (公開 API)
// ================================================================

/**
 * MAX_LENGTH を超えるデータを削除する。
 *
 * 内部では Worker への 1 呼び出し = 1 バッチ削除を `hasMore === false` になるまで繰り返す。
 * 単一呼び出しが巨大なトランザクションにならないため、タイムアウトが発生しにくい。
 *
 * @param options.mode - 'periodic' (default): 上限までの削減 / 'emergency': targetRatio までの削減
 * @param options.targetRatio - emergency モードで残す割合 (default 0.5)
 * @param options.kind - Worker キューの振り分け (default 'other'; 緊急時は 'priority')
 */
export async function enforceMaxLength(
  options?: EnforceMaxLengthOptions,
): Promise<void> {
  const handle = await getSqliteDb()
  const mode = options?.mode ?? 'periodic'
  const targetRatio = options?.targetRatio ?? EMERGENCY_TARGET_RATIO
  const kind = options?.kind ?? 'other'

  let iteration = 0
  while (iteration < MAX_BATCH_ITERATIONS) {
    iteration++
    const result = (await handle.sendCommand(
      {
        mode,
        targetRatio,
        type: 'enforceMaxLength',
      },
      { kind },
    )) as EnforceMaxLengthResponse | undefined
    if (!result?.hasMore) break
  }
  if (iteration >= MAX_BATCH_ITERATIONS) {
    console.warn(
      `[cleanup] enforceMaxLength reached MAX_BATCH_ITERATIONS (${MAX_BATCH_ITERATIONS}); remaining work will be processed on the next invocation.`,
    )
  }
}

// ================================================================
// 定期クリーンアップ
// ================================================================

let isPeriodicRunning = false

async function runPeriodicCleanup(): Promise<void> {
  if (isPeriodicRunning) return
  isPeriodicRunning = true
  try {
    await enforceMaxLength({ kind: 'other', mode: 'periodic' })
  } finally {
    isPeriodicRunning = false
  }
}

/**
 * 定期クリーンアップの開始
 *
 * - 初回実行は INITIAL_DELAY_MS 遅延（起動直後の初期ロードと競合しないように）
 * - PERIODIC_INTERVAL_MS (10 分) 周期で実行
 * - 失敗時は RETRY_DELAY_MS (1 分) 後にリトライ、最大 MAX_CONSECUTIVE_FAILURES (3) 回まで
 *
 * 戻り値の関数で停止できる。
 */
export function startPeriodicCleanup(): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let consecutiveFailures = 0

  const schedule = (delayMs: number) => {
    if (stopped) return
    timer = setTimeout(() => {
      void (async () => {
        if (stopped) return
        try {
          await runPeriodicCleanup()
          consecutiveFailures = 0
          schedule(PERIODIC_INTERVAL_MS)
        } catch (error) {
          consecutiveFailures++
          console.error(
            `Failed to perform periodic cleanup (attempt ${consecutiveFailures})`,
            error,
          )
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            consecutiveFailures = 0
            schedule(PERIODIC_INTERVAL_MS)
          } else {
            schedule(RETRY_DELAY_MS)
          }
        }
      })()
    }, delayMs)
  }

  schedule(INITIAL_DELAY_MS)

  const stopSaturationWatcher = startSaturationWatcher()

  return () => {
    stopped = true
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
    stopSaturationWatcher()
  }
}

// ================================================================
// 緊急クリーンアップ（飽和検知）
// ================================================================

let isEmergencyRunning = false
let lastEmergencyFinishedAt = 0

async function triggerEmergencyCleanup(): Promise<void> {
  if (isEmergencyRunning) return
  isEmergencyRunning = true
  try {
    console.warn(
      '[cleanup] Queue saturation persisted; triggering emergency cleanup (targetRatio=' +
        EMERGENCY_TARGET_RATIO +
        ')',
    )
    await enforceMaxLength({
      kind: 'priority',
      mode: 'emergency',
      targetRatio: EMERGENCY_TARGET_RATIO,
    })
    console.info('[cleanup] Emergency cleanup completed')
  } catch (error) {
    console.error('[cleanup] Emergency cleanup failed', error)
  } finally {
    isEmergencyRunning = false
    lastEmergencyFinishedAt = Date.now()
  }
}

/**
 * 飽和監視ループを開始する。
 * SATURATION_TICK_MS ごとに isTimelineQueueSaturated() をチェックし、
 * - 連続飽和が SATURATION_DURATION_MS を超え
 * - 起動から INITIAL_GRACE_MS が経過しており
 * - 前回緊急クリーンアップから EMERGENCY_COOLDOWN_MS が経過している
 * 場合に緊急クリーンアップを発火する。
 *
 * 既に監視ループが起動している場合は新しいループを起動せず、既存を流用する。
 * 戻り値の関数で停止できる（参照カウント方式で最後の停止関数呼び出し時に実際に停止）。
 */
let saturationWatcherRefCount = 0
let saturationWatcherIntervalId: ReturnType<typeof setInterval> | null = null

function startSaturationWatcher(): () => void {
  saturationWatcherRefCount++
  if (saturationWatcherIntervalId === null) {
    const startedAt = Date.now()
    let saturatedSince: number | null = null

    saturationWatcherIntervalId = setInterval(() => {
      const now = Date.now()

      if (!isTimelineQueueSaturated()) {
        saturatedSince = null
        return
      }

      if (saturatedSince === null) {
        saturatedSince = now
        return
      }

      if (now - saturatedSince < SATURATION_DURATION_MS) return
      if (now - startedAt < INITIAL_GRACE_MS) return
      if (isEmergencyRunning) return
      if (
        lastEmergencyFinishedAt > 0 &&
        now - lastEmergencyFinishedAt < EMERGENCY_COOLDOWN_MS
      ) {
        return
      }

      // 発火条件を満たした: 連続飽和カウンタをリセットして発火
      saturatedSince = null
      void triggerEmergencyCleanup()
    }, SATURATION_TICK_MS)
  }

  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    saturationWatcherRefCount = Math.max(0, saturationWatcherRefCount - 1)
    if (
      saturationWatcherRefCount === 0 &&
      saturationWatcherIntervalId !== null
    ) {
      clearInterval(saturationWatcherIntervalId)
      saturationWatcherIntervalId = null
    }
  }
}

// ================================================================
// テスト用エクスポート（内部状態のリセット）
// ================================================================

/** @internal テストからのみ使用する */
export function __resetCleanupStateForTest(): void {
  isPeriodicRunning = false
  isEmergencyRunning = false
  lastEmergencyFinishedAt = 0
}

/** @internal テスト用の定数 */
export const __CLEANUP_CONSTANTS = {
  EMERGENCY_COOLDOWN_MS,
  EMERGENCY_TARGET_RATIO,
  INITIAL_DELAY_MS,
  INITIAL_GRACE_MS,
  MAX_CONSECUTIVE_FAILURES,
  PERIODIC_INTERVAL_MS,
  RETRY_DELAY_MS,
  SATURATION_DURATION_MS,
  SATURATION_TICK_MS,
}
