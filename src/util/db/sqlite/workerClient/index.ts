/**
 * メインスレッド側 RPC クライアント
 *
 * Worker に対して型安全なメッセージを送信し、Promise で結果を受け取る。
 * changedTables フィールドを元に notifyChange を自動発火する。
 *
 * other キュー（書き込み・管理系読み込み等）と timeline キュー（タイムライン取得）
 * の 2 本立てで、other キューを優先的に処理する。
 * timeline キューは同一クエリ (SQL + bind + returnValue) が未処理なら重複追加しない。
 */

export { onSlowQueryLogs } from './messageHandler'
export {
  execAsync,
  execAsyncTimed,
  execBatch,
  executeFlatFetch,
  executeGraphPlan,
  executeQueryPlan,
  fetchTimeline,
  initWorker,
  sendCommand,
  terminateWorker,
} from './publicApi'
export { cancelStaleRequests } from './queueManager'
