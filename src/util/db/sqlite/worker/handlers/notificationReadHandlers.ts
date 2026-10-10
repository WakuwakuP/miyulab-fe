import type { NotificationReadMutation } from 'util/notificationReadState'
import {
  compareNotificationIds,
  notificationReadState,
} from 'util/notificationReadState'
import { lastChangeCount, resolveLocalAccountId } from '../../helpers'
import type { TableName } from '../../protocol'
import type { DbExec } from './types'

function resolveReadBoundary(
  current: string | null,
  incoming: string | undefined,
): string | null {
  if (!incoming) return current
  const order = current ? compareNotificationIds(incoming, current) : 1
  if (order === null) throw new Error('既読境界の順序を確認できません')
  return order >= 0 ? incoming : current
}

function updateReadState(
  db: DbExec,
  localAccountId: number,
  changedTables: Set<TableName>,
  id: string,
  read: boolean,
) {
  db.exec(
    'UPDATE notifications SET is_read = ? WHERE local_account_id = ? AND local_id = ? AND is_read IS NOT 1 AND is_read IS NOT ?;',
    { bind: [read ? 1 : 0, localAccountId, id, read ? 1 : 0] },
  )
  if (lastChangeCount(db) > 0) changedTables.add('notifications')
}

function applyReadBoundary(
  db: DbExec,
  localAccountId: number,
  changedTables: Set<TableName>,
  boundary: string,
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
      updateReadState(db, localAccountId, changedTables, id, read)
  }
}

export function handleUpdateNotificationReadState(
  db: DbExec,
  mutation: NotificationReadMutation,
): { changedTables: TableName[] } {
  const { backendUrl, localAccountId, remoteAccountId } = mutation
  if (resolveLocalAccountId(db, backendUrl) !== localAccountId)
    throw new Error('通知のアカウントが変更されました')
  const accounts = db.exec(
    'SELECT remote_account_id, notification_last_read_id FROM local_accounts WHERE id = ? AND backend_url = ?;',
    { bind: [localAccountId, backendUrl], returnValue: 'resultRows' },
  ) as [string, string | null][]
  if (accounts[0]?.[0] !== remoteAccountId)
    throw new Error('通知のアカウントが一致しません')
  const boundary = resolveReadBoundary(accounts[0][1], mutation.boundary)
  const changedTables = new Set<TableName>()
  db.exec('BEGIN;')
  try {
    if (boundary) applyReadBoundary(db, localAccountId, changedTables, boundary)
    for (const state of mutation.updates ?? [])
      updateReadState(db, localAccountId, changedTables, state.id, state.isRead)
    db.exec('COMMIT;')
  } catch (error) {
    db.exec('ROLLBACK;')
    throw error
  }
  return { changedTables: [...changedTables] }
}
