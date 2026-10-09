import type { Entity } from 'megalodon'
import type { App } from 'types/types'

export class NotificationApiError extends Error {
  constructor(readonly status: number) {
    super(`通知API: HTTP ${status}`)
  }
}

export async function notificationApi(
  app: App,
  path: string,
  body?: object,
  params?: URLSearchParams,
  timeoutMs = 15000,
): Promise<unknown> {
  if (app.backend === 'misskey')
    body = { ...body, i: app.tokenData?.access_token }
  const url = new URL(path, app.backendUrl)
  if (params) url.search = params.toString()
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${app.tokenData?.access_token ?? ''}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    method: body ? 'POST' : 'GET',
    ...(body ? { body: JSON.stringify(body) } : {}),
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new NotificationApiError(response.status)
  if (response.status === 204) return null
  return response.json()
}

export function pleromaReadUpdates(
  data: unknown,
): { id: string; isRead: boolean }[] {
  const rows = Array.isArray(data) ? data : [data]
  return rows.flatMap((row) =>
    typeof row?.id === 'string' && typeof row?.pleroma?.is_seen === 'boolean'
      ? [{ id: row.id, isRead: row.pleroma.is_seen }]
      : [],
  )
}

export async function decoratePleromaNotifications(
  app: App,
  data: Entity.Notification[],
  params?: URLSearchParams,
  id?: string,
): Promise<Entity.Notification[]> {
  try {
    const raw = await notificationApi(
      app,
      id
        ? `/api/v1/notifications/${encodeURIComponent(id)}`
        : '/api/v1/notifications',
      undefined,
      params,
    )
    const states = new Map(
      pleromaReadUpdates(raw).map((state) => [state.id, state.isRead]),
    )
    return data.map((notification) => ({
      ...notification,
      isRead: states.get(notification.id) ?? null,
    }))
  } catch {
    // Metadata failure must not prevent fetching notification bodies.
    return data
  }
}
