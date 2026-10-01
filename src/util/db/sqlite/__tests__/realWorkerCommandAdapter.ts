import { DatabaseSync } from 'node:sqlite'
import {
  buildTimelineKey,
  clearAllCaches,
  resolveLocalAccountId,
} from 'util/db/sqlite/helpers'
import type { SendCommandPayload } from 'util/db/sqlite/protocol'
import { createFreshSchema } from 'util/db/sqlite/schema'
import type { DbHandle } from 'util/db/sqlite/types'
import {
  handleBulkUpsertCustomEmojis,
  handleEnsureLocalAccount,
} from 'util/db/sqlite/worker/handlers/accountHandlers'
import {
  handleToggleReaction,
  handleUpdateStatusAction,
} from 'util/db/sqlite/worker/handlers/interactionHandlers'
import {
  handleBulkUpsertStatuses,
  handleUpsertStatus,
} from 'util/db/sqlite/worker/handlers/statusHandlers'
import { resolvePostIdInternal } from 'util/db/sqlite/worker/handlers/statusHelpers'
import { handleUpdateStatus } from 'util/db/sqlite/worker/handlers/statusUpdateHandler'
import {
  handleDeleteEvent,
  handleRemoveFromTimeline,
} from 'util/db/sqlite/worker/handlers/timelineHandlers'
import type { DbExec } from 'util/db/sqlite/worker/handlers/types'
import {
  handleAddNotification,
  handleBulkAddNotifications,
  handleUpdateNotificationStatusAction,
} from 'util/db/sqlite/worker/workerNotificationStore'

const EMPTY_CHANGED_TABLES = { changedTables: [] as const }

export function createRealWorkerDb(): { db: DbExec; native: DatabaseSync } {
  clearAllCaches()
  const native = new DatabaseSync(':memory:')
  const db: DbExec = {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ): unknown => {
      if (opts?.returnValue === 'resultRows') {
        const stmt = native.prepare(sql)
        stmt.setReturnArrays(true)
        return opts.bind ? stmt.all(...opts.bind) : stmt.all()
      }
      if (opts?.bind) {
        return native.prepare(sql).run(...opts.bind)
      }
      return native.exec(sql)
    },
  }
  createFreshSchema({ db })
  return { db, native }
}

export function createSendCommandAdapter(db: DbExec): {
  calls: SendCommandPayload[]
  handle: Pick<DbHandle, 'sendCommand'>
  sendCommand: (command: SendCommandPayload) => Promise<unknown>
} {
  const calls: SendCommandPayload[] = []
  const sendCommand = async (command: SendCommandPayload): Promise<unknown> => {
    calls.push(command)
    switch (command.type) {
      case 'upsertStatus':
        return handleUpsertStatus(
          db,
          command.statusJson,
          command.backendUrl,
          command.timelineType,
          command.tag,
        )
      case 'bulkUpsertStatuses':
        return handleBulkUpsertStatuses(
          db,
          command.statusesJson,
          command.backendUrl,
          command.timelineType,
          command.tag,
          command.skipProfileUpdate,
        )
      case 'updateStatusAction': {
        const localAccountId = resolveLocalAccountId(db, command.backendUrl)
        if (localAccountId == null) return EMPTY_CHANGED_TABLES
        return handleUpdateStatusAction(
          db,
          localAccountId,
          command.statusId,
          command.action,
          command.value,
        )
      }
      case 'updateStatus':
        return handleUpdateStatus(db, command.statusJson, command.backendUrl)
      case 'handleDeleteEvent': {
        const localAccountId = resolveLocalAccountId(db, command.backendUrl)
        if (localAccountId == null) return EMPTY_CHANGED_TABLES
        return handleDeleteEvent(db, localAccountId, command.statusId)
      }
      case 'removeFromTimeline': {
        const localAccountId = resolveLocalAccountId(db, command.backendUrl)
        if (localAccountId == null) return EMPTY_CHANGED_TABLES
        const timelineKey = buildTimelineKey(command.timelineType, {
          tag: command.tag,
        })
        const postId = resolvePostIdInternal(
          db,
          localAccountId,
          command.statusId,
        )
        if (postId == null) return EMPTY_CHANGED_TABLES
        return handleRemoveFromTimeline(db, localAccountId, timelineKey, postId)
      }
      case 'addNotification':
        return handleAddNotification(
          db,
          command.notificationJson,
          command.backendUrl,
        )
      case 'bulkAddNotifications':
        return handleBulkAddNotifications(
          db,
          command.notificationsJson,
          command.backendUrl,
        )
      case 'updateNotificationStatusAction':
        return handleUpdateNotificationStatusAction(
          db,
          command.backendUrl,
          command.statusId,
          command.action,
          command.value,
        )
      case 'ensureLocalAccount':
        return handleEnsureLocalAccount(
          db,
          command.backendUrl,
          command.accountJson,
        )
      case 'toggleReaction': {
        const localAccountId = resolveLocalAccountId(db, command.backendUrl)
        if (localAccountId == null) return EMPTY_CHANGED_TABLES
        return handleToggleReaction(
          db,
          localAccountId,
          command.statusId,
          command.value,
          command.emoji,
        )
      }
      case 'bulkUpsertCustomEmojis':
        return handleBulkUpsertCustomEmojis(
          db,
          command.backendUrl,
          command.emojisJson,
        )
      default:
        throw new Error(
          `Unhandled command type in test adapter: ${
            (command as { type: string }).type
          }`,
        )
    }
  }
  return { calls, handle: { sendCommand }, sendCommand }
}
