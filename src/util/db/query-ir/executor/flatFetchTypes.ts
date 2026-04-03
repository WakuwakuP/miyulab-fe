// ============================================================
// Flat Fetch — 型定義
//
// フローエディタでフィルタ済みの post_ids / notification_ids を受け取り、
// 最小限のクエリで表示データを取得する「フラットフェッチ」の型定義。
// ============================================================

import type { SqliteStoredNotification } from '../../sqlite/notificationStore'
import type { SqliteStoredStatus } from '../../sqlite/queries/statusMapper'
import type { DisplayOrderEntry } from './types'

// --------------- Worker リクエスト ---------------

/** Worker RPC リクエスト型 (Main Thread → Worker) */
export type ExecuteFlatFetchRequest = {
  id: number
  request: FlatFetchRequest
  type: 'executeFlatFetch'
}

// --------------- リクエスト ---------------

/**
 * フラットフェッチリクエスト
 *
 * フロー実行結果から受け取ったID群と表示順序を指定する。
 * postIds / notificationIds の少なくとも一方が空でない必要がある。
 */
export type FlatFetchRequest = {
  /** 表示対象の投稿ID一覧（フロー実行で事前フィルタ済み） */
  postIds: number[]
  /** 表示対象の通知ID一覧（フロー実行で事前フィルタ済み） */
  notificationIds: number[]
  /** バックエンドURL一覧（scoped query 用） */
  backendUrls: string[]
  /** 表示順序（フロー実行の sort/pagination 適用済み） */
  displayOrder: DisplayOrderEntry[]
}

// --------------- 結果 ---------------

/**
 * フラットフェッチ結果
 *
 * Worker 内で組み立て済みの Entity を返す。
 * メインスレッドでの追加 assembly は不要。
 */
export type FlatFetchResult = {
  /** 投稿データ — post_id をキーとした Map（リブログ親含む） */
  posts: Map<number, SqliteStoredStatus>
  /** 通知データ — notification_id をキーとした Map */
  notifications: Map<number, SqliteStoredNotification>
  /** 表示順序（リクエストの displayOrder をそのまま返す） */
  displayOrder: DisplayOrderEntry[]
  /** メタ情報 */
  meta: {
    sourceType: 'post' | 'notification' | 'mixed'
    totalDurationMs: number
  }
}
