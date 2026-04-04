/**
 * workerClient のモジュールレベル状態
 *
 * 各サブモジュールから共有される内部状態を一元管理する。
 */

import type { ChangeHint } from '../connection'
import type { SlowQueryLogEntry, TableName } from '../protocol'
import type { PendingRequest, QueuedRequest } from './types'

// ================================================================
// 定数
// ================================================================

export const TIMEOUT_MS = 30_000
export const INIT_TIMEOUT_MS = 15_000

// ================================================================
// 内部状態
// ================================================================

export let worker: Worker | null = null
export let nextId = 0
export const pending = new Map<number, PendingRequest>()

/** other キュー（優先） */
export const otherQueue: QueuedRequest[] = []
/** タイムライン取得キュー */
export const timelineQueue: QueuedRequest[] = []
/**
 * タイムライン取得キューの重複排除マップ
 * key = SQL + JSON(bind) + returnValue, value = 共有される Promise の resolve/reject 配列
 */
export const timelineDedup = new Map<
  string,
  { resolvers: ((v: unknown) => void)[]; rejectors: ((e: Error) => void)[] }
>()

export let activeRequest = false
/** other キューを連続処理した回数（timeline 飢餓防止用） */
export let consecutiveOther = 0
export let notifyChangeCallback:
  | ((table: TableName, hint?: ChangeHint) => void)
  | null = null
export let initResolve: ((persistence: 'opfs' | 'memory') => void) | null = null
export let initReject: ((reason: Error) => void) | null = null
export let initPromise: Promise<'opfs' | 'memory'> | null = null
export let initTimer: ReturnType<typeof setTimeout> | null = null
export const durationForId = new Map<number, number>()

/** スロークエリログのコールバック */
export let slowQueryLogCallback: ((logs: SlowQueryLogEntry[]) => void) | null =
  null

// ================================================================
// let 変数の setter（外部モジュールから再代入するため）
// ================================================================

export function setWorker(w: Worker | null): void {
  worker = w
}
export function setNextId(id: number): void {
  nextId = id
}
export function incrementNextId(): number {
  return nextId++
}
export function setActiveRequest(v: boolean): void {
  activeRequest = v
}
export function setConsecutiveOther(v: number): void {
  consecutiveOther = v
}
export function setNotifyChangeCallback(
  cb: ((table: TableName, hint?: ChangeHint) => void) | null,
): void {
  notifyChangeCallback = cb
}
export function setInitResolve(
  fn: ((persistence: 'opfs' | 'memory') => void) | null,
): void {
  initResolve = fn
}
export function setInitReject(fn: ((reason: Error) => void) | null): void {
  initReject = fn
}
export function setInitPromise(p: Promise<'opfs' | 'memory'> | null): void {
  initPromise = p
}
export function setInitTimer(t: ReturnType<typeof setTimeout> | null): void {
  initTimer = t
}
export function setSlowQueryLogCallback(
  cb: ((logs: SlowQueryLogEntry[]) => void) | null,
): void {
  slowQueryLogCallback = cb
}
