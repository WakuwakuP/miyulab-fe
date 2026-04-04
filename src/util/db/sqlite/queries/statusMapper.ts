/**
 * Status の型定義とマッピング関数 — バレルモジュール
 *
 * 実装は以下のファイルに分割されている:
 * - statusMapperTypes.ts    … 型定義 (TimelineType, SqliteStoredStatus, InteractionsJson)
 * - statusMapperParsers.ts  … JSON パーサー群
 * - rowToStoredStatus.ts    … インラインクエリ行 → SqliteStoredStatus
 * - assembleStatusFromBatch.ts … バッチクエリ行 → SqliteStoredStatus
 * - toStoredStatus.ts       … Entity.Status → SqliteStoredStatus
 */

export { assembleStatusFromBatch } from './assembleStatusFromBatch'
export { rowToStoredStatus } from './rowToStoredStatus'
export {
  editedAtMsToIso,
  parseBatchPoll,
  parseEmojiReactions,
  parseEmojis,
  parseInteractions,
  parseMediaAttachments,
  parseMentions,
} from './statusMapperParsers'
export type {
  InteractionsJson,
  SqliteStoredStatus,
  TimelineType,
} from './statusMapperTypes'
export { toStoredStatus } from './toStoredStatus'
