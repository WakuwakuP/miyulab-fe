/**
 * SQLite DB モジュール - バレルエクスポート
 */

// Cleanup
export {
  cleanupOldData,
  enforceMaxLength,
  startPeriodicCleanup,
} from './cleanup'
export type { DbHandle, TableName } from './connection'
// Connection & change notifications
export { getSqliteDb, notifyChange, subscribe } from './connection'
// Migration
export { isMigrated, migrateFromIndexedDb } from './migration'
export type { SqliteStoredNotification } from './notificationStore'
// Notification store
export {
  addNotification,
  bulkAddNotifications,
  getNotifications,
  updateNotificationStatusAction,
} from './notificationStore'
export type { SqliteStoredStatus } from './statusStore'
// Status store
export {
  bulkUpsertStatuses,
  createCompositeKey,
  getStatusesByCustomQuery,
  getStatusesByTag,
  getStatusesByTimelineType,
  handleDeleteEvent,
  QUERY_COMPLETIONS,
  removeFromTimeline,
  toStoredStatus,
  updateStatus,
  updateStatusAction,
  upsertStatus,
} from './statusStore'
