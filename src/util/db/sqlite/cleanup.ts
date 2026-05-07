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
  /**
   * Worker キューの振り分け (default 'priority')。
   *
   * クリーンアップは書き込み・タイムライン取得より優先して処理する方針のため、
   * 基本的にすべて 'priority' で投入する。テスト等の特殊用途で上書き可能。
   */
  kind?: 'priority' | 'other'
}

type EnforceMaxLengthResponse = {
  hasMore?: boolean
  deletedCounts?: {
    timeline_entries: number
    notifications: number
    posts: number
  }
  phaseTimings?: {
    timeline: number
    notifications: number
    postsCount: number
    postsDelete: number
    phase1Total: number
    phase2Total: number
    total: number
  }
}

type TableCounts = {
  timeline_entries: number
  notifications: number
  posts: number
}

/**
 * 直前の enforceMaxLength 完了時点でのテーブル件数。
 * 次回実行時の「前回からの変動」算出に使う。
 * undefined のときは初回実行（差分は表示しない）。
 */
let lastTableCounts: TableCounts | undefined

/**
 * 主要 3 テーブルの行数を取得する。
 *
 * クリーンアップは priority キューで実行されるため、件数取得もそれに合わせる。
 * 失敗してもクリーンアップ本体の挙動には影響を与えないよう、呼び出し側で握り潰す。
 */
async function fetchTableCounts(
  handle: Awaited<ReturnType<typeof getSqliteDb>>,
): Promise<TableCounts> {
  // 注: execAsync の kind は 'timeline' | 'other' のみ。
  // クリーンアップ完了後の単発カウント取得なので 'other' で十分。
  const rows = (await handle.execAsync(
    `SELECT
       (SELECT COUNT(*) FROM timeline_entries) AS te,
       (SELECT COUNT(*) FROM notifications)    AS n,
       (SELECT COUNT(*) FROM posts)            AS p;`,
    { kind: 'other', returnValue: 'resultRows' },
  )) as number[][]
  const row = rows[0] ?? [0, 0, 0]
  return {
    notifications: (row[1] as number) ?? 0,
    posts: (row[2] as number) ?? 0,
    timeline_entries: (row[0] as number) ?? 0,
  }
}

/** +N / -N / ±0 形式の差分文字列を作る */
function formatDelta(current: number, previous: number | undefined): string {
  if (previous === undefined) return 'n/a'
  const diff = current - previous
  if (diff > 0) return `+${diff}`
  if (diff < 0) return `${diff}`
  return '±0'
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
 * @param options.kind - Worker キューの振り分け (default 'priority')。
 *   クリーンアップは他の書き込みより優先処理する方針のため、基本 'priority' を使う。
 */
export async function enforceMaxLength(
  options?: EnforceMaxLengthOptions,
): Promise<void> {
  const handle = await getSqliteDb()
  const mode = options?.mode ?? 'periodic'
  const targetRatio = options?.targetRatio ?? EMERGENCY_TARGET_RATIO
  const kind = options?.kind ?? 'priority'

  const startedAt = Date.now()
  const totalDeleted = {
    notifications: 0,
    posts: 0,
    timeline_entries: 0,
  }
  // バッチ横断のフェーズ別経過時間集計 (ms)
  const phaseTotals = {
    notifications: 0,
    phase1Total: 0,
    phase2Total: 0,
    postsCount: 0,
    postsDelete: 0,
    timeline: 0,
    workerTotal: 0,
  }
  /** worker から phaseTimings を 1 回でも受け取ったか */
  let phaseTimingsAvailable = false
  /** 1 バッチ中で 規定値を超えたフェーズがあれば記録 (ms) */
  let maxBatchPhase2 = 0
  let maxBatchPostsDelete = 0

  let iteration = 0
  let aborted = false
  let abortError: unknown
  try {
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
      if (result?.deletedCounts) {
        totalDeleted.timeline_entries += result.deletedCounts.timeline_entries
        totalDeleted.notifications += result.deletedCounts.notifications
        totalDeleted.posts += result.deletedCounts.posts
      }
      if (result?.phaseTimings) {
        phaseTimingsAvailable = true
        const pt = result.phaseTimings
        phaseTotals.timeline += pt.timeline
        phaseTotals.notifications += pt.notifications
        phaseTotals.postsCount += pt.postsCount
        phaseTotals.postsDelete += pt.postsDelete
        phaseTotals.phase1Total += pt.phase1Total
        phaseTotals.phase2Total += pt.phase2Total
        phaseTotals.workerTotal += pt.total
        if (pt.phase2Total > maxBatchPhase2) maxBatchPhase2 = pt.phase2Total
        if (pt.postsDelete > maxBatchPostsDelete) {
          maxBatchPostsDelete = pt.postsDelete
        }
      }
      if (!result?.hasMore) break
    }
    if (iteration >= MAX_BATCH_ITERATIONS) {
      console.warn(
        `[cleanup] enforceMaxLength reached MAX_BATCH_ITERATIONS (${MAX_BATCH_ITERATIONS}); remaining work will be processed on the next invocation.`,
      )
    }
  } catch (error) {
    aborted = true
    abortError = error
    throw error
  } finally {
    const elapsedMs = Date.now() - startedAt
    const totalCount =
      totalDeleted.timeline_entries +
      totalDeleted.notifications +
      totalDeleted.posts
    const status = aborted ? 'aborted (partial)' : 'completed'
    const summary = `[cleanup] enforceMaxLength ${status} (mode=${mode}, kind=${kind}, iterations=${iteration}, elapsedMs=${elapsedMs}, deleted: timeline_entries=${totalDeleted.timeline_entries}, notifications=${totalDeleted.notifications}, posts=${totalDeleted.posts}, total=${totalCount})`

    // フェーズ別経過時間サマリ (Worker 側で計測)。タイムアウト原因切り分けに使う。
    // すべてミリ秒、全バッチの合計とバッチ単位の最大値を表示。
    let timingsLine: string | undefined
    if (phaseTimingsAvailable) {
      timingsLine =
        `[cleanup] phase timings (sum across batches, ms): ` +
        `phase1Total=${Math.round(phaseTotals.phase1Total)}, ` +
        `phase2Total=${Math.round(phaseTotals.phase2Total)} ` +
        `(maxBatch=${Math.round(maxBatchPhase2)}), ` +
        `timeline=${Math.round(phaseTotals.timeline)}, ` +
        `notifications=${Math.round(phaseTotals.notifications)}, ` +
        `postsCount=${Math.round(phaseTotals.postsCount)}, ` +
        `postsDelete=${Math.round(phaseTotals.postsDelete)} ` +
        `(maxBatch=${Math.round(maxBatchPostsDelete)}), ` +
        `workerTotal=${Math.round(phaseTotals.workerTotal)}`
    }

    // 完了/中断後のテーブル件数と前回からの変動を表示する。
    // 件数取得自体が失敗してもクリーンアップ結果ログは残す。
    let countsLine: string | undefined
    try {
      const current = await fetchTableCounts(handle)
      const teDelta = formatDelta(
        current.timeline_entries,
        lastTableCounts?.timeline_entries,
      )
      const nDelta = formatDelta(
        current.notifications,
        lastTableCounts?.notifications,
      )
      const pDelta = formatDelta(current.posts, lastTableCounts?.posts)
      countsLine = `[cleanup] table counts after ${status}: timeline_entries=${current.timeline_entries} (${teDelta}), notifications=${current.notifications} (${nDelta}), posts=${current.posts} (${pDelta})`
      lastTableCounts = current
    } catch (countErr) {
      countsLine = `[cleanup] table counts unavailable: ${String(countErr)}`
    }

    if (aborted) {
      console.warn(summary, abortError)
      if (timingsLine) console.warn(timingsLine)
      if (countsLine) console.warn(countsLine)
    } else {
      console.info(summary)
      if (timingsLine) console.info(timingsLine)
      if (countsLine) console.info(countsLine)
    }
  }
}

// ================================================================
// 定期クリーンアップ
// ================================================================

let isPeriodicRunning = false

async function runPeriodicCleanup(): Promise<void> {
  if (isPeriodicRunning) return
  isPeriodicRunning = true
  console.info('[cleanup] Periodic cleanup started')
  const startedAt = Date.now()
  let succeeded = false
  try {
    // 定期クリーンアップも priority キューで処理し、書き込み・タイムライン取得より優先する。
    // other キューで投入すると bulkUpsertStatuses 等と競合して 90s timeout に巻き込まれやすい。
    await enforceMaxLength({ kind: 'priority', mode: 'periodic' })
    succeeded = true
  } finally {
    const elapsedMs = Date.now() - startedAt
    if (succeeded) {
      console.info(
        `[cleanup] Periodic cleanup finished (elapsedMs=${elapsedMs})`,
      )
    } else {
      console.warn(
        `[cleanup] Periodic cleanup aborted (elapsedMs=${elapsedMs})`,
      )
    }
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
  const startedAt = Date.now()
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
    console.info(
      `[cleanup] Emergency cleanup completed (elapsedMs=${Date.now() - startedAt})`,
    )
  } catch (error) {
    console.error(
      `[cleanup] Emergency cleanup failed (elapsedMs=${Date.now() - startedAt})`,
      error,
    )
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
  lastTableCounts = undefined
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
