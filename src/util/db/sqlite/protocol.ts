/**
 * RPC プロトコル型定義 — SQLite OPFS Worker
 *
 * Main Thread ↔ Worker 間のメッセージ型を定義する。
 * 04-reactive-behavior-analysis.md の修正版プロトコルに基づく。
 */

// ================================================================
// 共通型
// ================================================================

export type BindValue = string | number | null

export type TableName =
  | 'posts'
  | 'notifications'
  | 'timeline_entries'
  | 'post_interactions'
  | 'post_backend_ids'
  | 'post_mentions'
  | 'profiles'
  | 'local_accounts'

// ================================================================
// Main Thread → Worker (リクエスト)
// ================================================================

/** 汎用 READ（SELECT のみ） */
export type ExecRequest = {
  type: 'exec'
  id: number
  sql: string
  bind?: BindValue[]
  returnValue?: 'resultRows'
}

/** 汎用 WRITE（単純な INSERT/UPDATE/DELETE、分岐なし） */
export type ExecBatchRequest = {
  type: 'execBatch'
  id: number
  statements: {
    sql: string
    bind?: BindValue[]
    returnValue?: 'resultRows'
  }[]
  rollbackOnError: boolean
  returnIndices?: number[]
}

/** Worker 初期化完了確認 */
export type ReadyRequest = {
  type: 'ready'
  id: number
}

// ================================================================
// 専用ハンドラリクエスト型
// ================================================================

/** Status 1 件の upsert */
export type UpsertStatusRequest = {
  type: 'upsertStatus'
  id: number
  statusJson: string
  backendUrl: string
  timelineType: string
  tag?: string
}

/** Status 複数件の一括 upsert */
export type BulkUpsertStatusesRequest = {
  type: 'bulkUpsertStatuses'
  id: number
  statusesJson: string[]
  backendUrl: string
  timelineType: string
  tag?: string
}

/** Status のアクション状態更新 */
export type UpdateStatusActionRequest = {
  type: 'updateStatusAction'
  id: number
  backendUrl: string
  statusId: string
  action: 'reblogged' | 'favourited' | 'bookmarked'
  value: boolean
}

/** Status 全体の更新（編集された投稿用） */
export type UpdateStatusRequest = {
  type: 'updateStatus'
  id: number
  statusJson: string
  backendUrl: string
}

/** delete イベント処理 */
export type HandleDeleteEventRequest = {
  type: 'handleDeleteEvent'
  id: number
  backendUrl: string
  statusId: string
  sourceTimelineType: string
  tag?: string
}

/** タイムラインからの除外 */
export type RemoveFromTimelineRequest = {
  type: 'removeFromTimeline'
  id: number
  backendUrl: string
  statusId: string
  timelineType: string
  tag?: string
}

/** Notification 追加 */
export type AddNotificationRequest = {
  type: 'addNotification'
  id: number
  notificationJson: string
  backendUrl: string
}

/** Notification 一括追加 */
export type BulkAddNotificationsRequest = {
  type: 'bulkAddNotifications'
  id: number
  notificationsJson: string[]
  backendUrl: string
}

/** Notification 内 Status アクション更新 */
export type UpdateNotificationStatusActionRequest = {
  type: 'updateNotificationStatusAction'
  id: number
  backendUrl: string
  statusId: string
  action: 'reblogged' | 'favourited' | 'bookmarked'
  value: boolean
}

/** MAX_LENGTH クリーンアップ */
export type EnforceMaxLengthRequest = {
  type: 'enforceMaxLength'
  id: number
}

/** フォロー関係の同期 */
export type SyncFollowsRequest = {
  type: 'syncFollows'
  id: number
  backendUrl: string
  accountsJson: string[]
}

/** データベースを単一 sqlite3 ファイルとして OPFS にエクスポート */
export type ExportDatabaseRequest = {
  type: 'exportDatabase'
  id: number
}

/** ローカルアカウントの登録・更新 */
export type EnsureLocalAccountRequest = {
  type: 'ensureLocalAccount'
  id: number
  backendUrl: string
  accountJson: string
}

/** リアクションの追加/削除 */
export type ToggleReactionRequest = {
  type: 'toggleReaction'
  id: number
  backendUrl: string
  statusId: string
  value: boolean
  emoji: string // ':blobcat:' or '👍'
}

/** カスタム絵文字の一括登録（サーバ絵文字カタログのDBキャッシュ） */
export type BulkUpsertCustomEmojisRequest = {
  type: 'bulkUpsertCustomEmojis'
  id: number
  backendUrl: string
  emojisJson: string
}

/** タイムライン一括取得リクエスト */
export type FetchTimelineRequest = {
  type: 'fetchTimeline'
  id: number
  /** Phase1 クエリ */
  phase1: {
    sql: string
    bind: BindValue[]
  }
  /** Phase2 ベース SQL テンプレート（{IDS} プレースホルダを含む） */
  phase2BaseSql: string
  /** Batch SQL テンプレート群（{IDS} プレースホルダを含む） */
  batchSqls: {
    interactions: string
    media: string
    mentions: string
    timelineTypes: string
    belongingTags: string
    customEmojis: string
    profileEmojis: string
    polls: string
  }
  /** Phase2 結果から reblog_of_post_id を抽出するカラムインデックス */
  reblogPostIdColumnIndex?: number
}

/** タイムライン一括取得の結果 */
export type FetchTimelineResult = {
  phase1Rows: (string | number | null)[][]
  phase2Rows: (string | number | null)[][]
  batchResults: {
    interactions: (string | number | null)[][]
    media: (string | number | null)[][]
    mentions: (string | number | null)[][]
    timelineTypes: (string | number | null)[][]
    belongingTags: (string | number | null)[][]
    customEmojis: (string | number | null)[][]
    profileEmojis: (string | number | null)[][]
    polls: (string | number | null)[][]
  }
  totalDurationMs: number
}

// ================================================================
// Union 型
// ================================================================

export type WorkerRequest =
  | ExecRequest
  | ExecBatchRequest
  | ReadyRequest
  | UpsertStatusRequest
  | BulkUpsertStatusesRequest
  | UpdateStatusActionRequest
  | UpdateStatusRequest
  | HandleDeleteEventRequest
  | RemoveFromTimelineRequest
  | AddNotificationRequest
  | BulkAddNotificationsRequest
  | UpdateNotificationStatusActionRequest
  | EnforceMaxLengthRequest
  | SyncFollowsRequest
  | ExportDatabaseRequest
  | EnsureLocalAccountRequest
  | ToggleReactionRequest
  | BulkUpsertCustomEmojisRequest
  | FetchTimelineRequest

// ================================================================
// Worker → Main Thread (レスポンス)
// ================================================================

/** 成功レスポンス */
export type SuccessResponse = {
  type: 'response'
  id: number
  result: unknown
  changedTables?: TableName[]
  /** 変更のコンテキスト情報（Plan B: スマート無効化） */
  changeHint?: {
    timelineType?: string
    backendUrl?: string
    tag?: string
  }
  durationMs?: number
}

/** エラーレスポンス */
export type ErrorResponse = {
  type: 'error'
  id: number
  error: string
}

/** Worker 初期化完了通知 */
export type InitMessage = {
  type: 'init'
  persistence: 'opfs' | 'memory'
}

/** Worker → Main Thread 全メッセージ型 */
export type WorkerMessage = SuccessResponse | ErrorResponse | InitMessage

// ================================================================
// sendCommand 用: id を除外したコマンドペイロード型
// ================================================================

/** sendCommand に渡すコマンド（id は自動付与） */
/** Distributive Omit — union の各 member から個別に key を除去する */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never

export type SendCommandPayload = DistributiveOmit<
  Exclude<
    WorkerRequest,
    ExecRequest | ExecBatchRequest | ReadyRequest | FetchTimelineRequest
  >,
  'id'
>
