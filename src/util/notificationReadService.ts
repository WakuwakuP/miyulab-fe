import type { App } from 'types/types'
import { resolveLocalAccountId } from 'util/accountResolver'
import { getSqliteDb } from 'util/db/sqlite/connection'
import {
  flushNotifications,
  updateNotificationReadState,
} from 'util/db/sqlite/notificationStore'
import { GetClient } from 'util/GetClient'
import {
  NotificationApiError,
  notificationApi,
  pleromaReadUpdates,
} from './notificationReadApi'
import type { NotificationReadMutation } from './notificationReadState'
import { compareNotificationIds } from './notificationReadState'

export function supportsNotificationRead(app: App): boolean {
  return (
    app.backend === 'mastodon' ||
    app.backend === 'pleroma' ||
    app.backend === 'misskey'
  )
}

function assertCurrent(isCurrent: () => boolean) {
  if (!isCurrent()) throw new Error('ログイン状態が変更されました')
}

async function resolveAccount(
  app: App,
  isCurrent: () => boolean,
): Promise<NotificationReadMutation> {
  assertCurrent(isCurrent)
  const credentials = await GetClient(app).verifyAccountCredentials()
  assertCurrent(isCurrent)
  const localAccountId = resolveLocalAccountId(app.backendUrl)
  if (localAccountId === null)
    throw new Error('通知のアカウントを確認できません')
  const handle = await getSqliteDb()
  const rows = (await handle.execAsync(
    'SELECT remote_account_id FROM local_accounts WHERE id = ? AND backend_url = ?;',
    { bind: [localAccountId, app.backendUrl], returnValue: 'resultRows' },
  )) as [string][]
  if (!credentials.data.id || rows[0]?.[0] !== credentials.data.id)
    throw new Error('通知のアカウントが一致しません')
  return {
    backendUrl: app.backendUrl,
    localAccountId,
    remoteAccountId: credentials.data.id,
  }
}

async function snapshotIds(
  account: NotificationReadMutation,
): Promise<string[]> {
  await flushNotifications()
  const handle = await getSqliteDb()
  const rows = (await handle.execAsync(
    'SELECT local_id FROM notifications WHERE local_account_id = ?;',
    { bind: [account.localAccountId], returnValue: 'resultRows' },
  )) as [string][]
  return rows.map(([id]) => id)
}

function markerId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const marker = (data as { notifications?: { last_read_id?: unknown } })
    .notifications
  return typeof marker?.last_read_id === 'string' &&
    marker.last_read_id.length > 0
    ? marker.last_read_id
    : null
}

async function fetchMarker(app: App): Promise<string | null> {
  return markerId(
    await notificationApi(
      app,
      '/api/v1/markers',
      undefined,
      new URLSearchParams([['timeline[]', 'notifications']]),
    ),
  )
}

async function latestId(app: App): Promise<string | null> {
  const rows = await notificationApi(
    app,
    '/api/v1/notifications',
    undefined,
    new URLSearchParams({ limit: '1' }),
  )
  if (!Array.isArray(rows)) throw new Error('通知APIの応答を確認できません')
  if (rows.length === 0) return null
  if (typeof rows[0]?.id !== 'string' || !rows[0].id)
    throw new Error('通知IDを確認できません')
  return rows[0].id
}

async function persist(
  mutation: NotificationReadMutation,
  isCurrent: () => boolean,
) {
  assertCurrent(isCurrent)
  await updateNotificationReadState(mutation, () => assertCurrent(isCurrent))
}

export async function syncNotificationReadState(
  app: App,
  isCurrent: () => boolean,
): Promise<void> {
  if (!supportsNotificationRead(app) || !app.tokenData) return
  const account = await resolveAccount(app, isCurrent)
  if (app.backend === 'mastodon') {
    const boundary = await fetchMarker(app)
    if (boundary) await persist({ ...account, boundary }, isCurrent)
  } else if (app.backend === 'pleroma') {
    const raw = await notificationApi(
      app,
      '/api/v1/notifications',
      undefined,
      new URLSearchParams({ limit: '80' }),
    )
    await persist({ ...account, updates: pleromaReadUpdates(raw) }, isCurrent)
  } else {
    const ids = await snapshotIds(account)
    const data = (await notificationApi(app, '/api/i')) as {
      hasUnreadNotification?: boolean
    }
    if (data?.hasUnreadNotification === false)
      await persist(
        { ...account, updates: ids.map((id) => ({ id, isRead: true })) },
        isCurrent,
      )
  }
}

export type NotificationReadTask = {
  app: App
  stage: 'write' | 'confirm' | 'save'
  mutation?: NotificationReadMutation
}

async function rethrowAfterSync(
  app: App,
  isCurrent: () => boolean,
  error: unknown,
): Promise<never> {
  try {
    await syncNotificationReadState(app, isCurrent)
  } catch {
    /* Keep the original failure. */
  }
  throw error
}

async function writeMisskeyRead(
  task: NotificationReadTask,
  account: NotificationReadMutation,
  isCurrent: () => boolean,
): Promise<void> {
  const ids = await snapshotIds(account)
  task.mutation = {
    ...account,
    updates: ids.map((id) => ({ id, isRead: true })),
  }
  assertCurrent(isCurrent)
  // A lost response may already have marked the server; retries only confirm.
  task.stage = 'confirm'
  try {
    await notificationApi(task.app, '/api/notifications/mark-all-as-read', {})
  } catch (error) {
    if (
      error instanceof NotificationApiError &&
      error.status < 500 &&
      error.status !== 408
    )
      task.stage = 'write'
    throw error
  }
}

function markerCovers(existing: string, boundary: string): boolean {
  const order = compareNotificationIds(existing, boundary)
  if (order === null) throw new Error('既読境界の順序を確認できません')
  return order >= 0
}

async function saveMarker(app: App, boundary: string): Promise<string> {
  const saved = markerId(
    await notificationApi(app, '/api/v1/markers', {
      notifications: { last_read_id: boundary },
    }),
  )
  const order = saved === null ? null : compareNotificationIds(saved, boundary)
  if (saved === null || order === null || order < 0)
    throw new Error('既読境界の保存を確認できません')
  return saved
}

async function writeMastodonMarker(
  app: App,
  mutation: NotificationReadMutation,
  boundary: string,
  isCurrent: () => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await fetchMarker(app)
    assertCurrent(isCurrent)
    if (existing && markerCovers(existing, boundary)) {
      mutation.boundary = existing
      return
    }
    try {
      mutation.boundary = await saveMarker(app, boundary)
      return
    } catch (error) {
      const retryable =
        error instanceof NotificationApiError &&
        error.status === 409 &&
        attempt === 0
      if (!retryable) await rethrowAfterSync(app, isCurrent, error)
    }
  }
}

async function writePleromaRead(
  app: App,
  mutation: NotificationReadMutation,
  boundary: string,
  isCurrent: () => boolean,
): Promise<void> {
  try {
    const raw = await notificationApi(
      app,
      '/api/v1/pleroma/notifications/read',
      { max_id: boundary },
    )
    mutation.updates = pleromaReadUpdates(raw)
  } catch (error) {
    await rethrowAfterSync(app, isCurrent, error)
  }
}

/** @returns 既読にする通知が無い場合 false */
async function writeBoundaryRead(
  task: NotificationReadTask,
  account: NotificationReadMutation,
  isCurrent: () => boolean,
): Promise<boolean> {
  const { app } = task
  const boundary = task.mutation?.boundary ?? (await latestId(app))
  if (!boundary) return false
  const mutation: NotificationReadMutation = { ...account, boundary }
  task.mutation = mutation
  assertCurrent(isCurrent)
  if (app.backend === 'mastodon') {
    await writeMastodonMarker(app, mutation, boundary, isCurrent)
  } else {
    await writePleromaRead(app, mutation, boundary, isCurrent)
  }
  task.stage = 'save'
  return true
}

async function confirmMisskeyRead(
  app: App,
  isCurrent: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 5000
  do {
    assertCurrent(isCurrent)
    const data = (await notificationApi(
      app,
      '/api/i',
      undefined,
      undefined,
      Math.max(1, deadline - Date.now()),
    ).catch((cause) => {
      assertCurrent(isCurrent)
      throw new Error('既読操作は受付済み・状態を確認できませんでした', {
        cause,
      })
    })) as { hasUnreadNotification?: boolean }
    if (data?.hasUnreadNotification === false) return
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(500, Math.max(0, deadline - Date.now()))),
    )
  } while (Date.now() < deadline)
  throw new Error('既読操作は受付済み・状態を確認できませんでした')
}

async function saveMutation(
  mutation: NotificationReadMutation,
  isCurrent: () => boolean,
): Promise<void> {
  try {
    await persist(mutation, isCurrent)
  } catch (error) {
    assertCurrent(isCurrent)
    throw new Error('サーバー反映済み・表示の同期に失敗しました', {
      cause: error,
    })
  }
}

export async function runNotificationReadTask(
  task: NotificationReadTask,
  isCurrent: () => boolean,
): Promise<void> {
  const account = await resolveAccount(task.app, isCurrent)
  if (task.mutation && task.mutation.localAccountId !== account.localAccountId)
    throw new Error('通知のアカウントが変更されました')
  if (task.stage === 'write') {
    if (task.app.backend === 'misskey') {
      await writeMisskeyRead(task, account, isCurrent)
    } else if (!(await writeBoundaryRead(task, account, isCurrent))) {
      return
    }
  }
  if (task.stage === 'confirm') {
    await confirmMisskeyRead(task.app, isCurrent)
    task.stage = 'save'
  }
  if (task.mutation) await saveMutation(task.mutation, isCurrent)
}
