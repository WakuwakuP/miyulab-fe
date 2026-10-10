import type { NotificationReadMutation } from 'util/notificationReadState'
import {
  compareNotificationIds,
  notificationReadState,
} from 'util/notificationReadState'
import { lastChangeCount, resolveLocalAccountId } from '../../helpers'
import type { TableName } from '../../protocol'
import type { DbExec } from './types'

/**
 * ミューテーションの対象アカウントを検証し、保存済みの既読境界を返す。
 */
function loadStoredBoundary(
  db: DbExec,
  mutation: NotificationReadMutation,
): string | null {
  const { backendUrl, localAccountId, remoteAccountId } = mutation
  if (resolveLocalAccountId(db, backendUrl) !== localAccountId)
    throw new Error('通知のアカウントが変更されました')
  const accounts = db.exec(
    'SELECT remote_account_id, notification_last_read_id FROM local_accounts WHERE id = ? AND backend_url = ?;',
    { bind: [localAccountId, backendUrl], returnValue: 'resultRows' },
  ) as [string, string | null][]
  if (accounts[0]?.[0] !== remoteAccountId)
    throw new Error('通知のアカウントが一致しません')
  return accounts[0][1]
}

/** 既読境界は後退させず、より新しい境界のみ採用する */
function resolveBoundary(
  stored: string | null,
  incoming: string | undefined,
): string | null {
  if (!incoming) return stored
  if (!stored) return incoming
  const order = compareNotificationIds(incoming, stored)
  if (order === null) throw new Error('既読境界の順序を確認できません')
  return order >= 0 ? incoming : stored
}

function updateNotificationRead(
  db: DbExec,
  localAccountId: number,
  id: string,
  read: boolean,
  changedTables: Set<TableName>,
) {
  const flag = read ? 1 : 0
  db.exec(
    'UPDATE notifications SET is_read = ? WHERE local_account_id = ? AND local_id = ? AND is_read IS NOT 1 AND is_read IS NOT ?;',
    { bind: [flag, localAccountId, id, flag] },
  )
  if (lastChangeCount(db) > 0) changedTables.add('notifications')
}

function applyBoundary(
  db: DbExec,
  localAccountId: number,
  boundary: string,
  changedTables: Set<TableName>,
) {
  db.exec(
    'UPDATE local_accounts SET notification_last_read_id = ? WHERE id = ? AND notification_last_read_id IS NOT ?;',
    { bind: [boundary, localAccountId, boundary] },
  )
  if (lastChangeCount(db) > 0) changedTables.add('local_accounts')
  const rows = db.exec(
    'SELECT local_id FROM notifications WHERE local_account_id = ?;',
    { bind: [localAccountId], returnValue: 'resultRows' },
  ) as [string][]
  for (const [id] of rows) {
    const read = notificationReadState(id, boundary)
    if (read !== null)
      updateNotificationRead(db, localAccountId, id, read, changedTables)
  }
}

export function handleUpdateNotificationReadState(
  db: DbExec,
  mutation: NotificationReadMutation,
): { changedTables: TableName[] } {
  const { localAccountId } = mutation
  const boundary = resolveBoundary(
    loadStoredBoundary(db, mutation),
    mutation.boundary,
  )
  const changedTables = new Set<TableName>()
  db.exec('BEGIN;')
  try {
    if (boundary) applyBoundary(db, localAccountId, boundary, changedTables)
    for (const state of mutation.updates ?? [])
      updateNotificationRead(
        db,
        localAccountId,
        state.id,
        state.isRead,
        changedTables,
      )
    db.exec('COMMIT;')
  } catch (error) {
    db.exec('ROLLBACK;')
    throw error
  }
  return { changedTables: [...changedTables] }
}
