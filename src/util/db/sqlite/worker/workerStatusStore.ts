/**
 * 後方互換バレルエクスポート
 * @deprecated 新しいコードは worker/handlers/ から直接インポートしてください
 */

export {
  handleBulkUpsertCustomEmojis,
  handleEnsureLocalAccount,
} from './handlers/accountHandlers'
export {
  handleToggleReaction,
  handleUpdateStatusAction,
} from './handlers/interactionHandlers'
export {
  handleBulkUpsertStatuses,
  handleUpsertStatus,
} from './handlers/statusHandlers'
export { handleUpdateStatus } from './handlers/statusUpdateHandler'
export {
  handleDeleteEvent,
  handleRemoveFromTimeline,
} from './handlers/timelineHandlers'
