import type { Entity, Response } from 'megalodon'
import {
  type MisskeyClientContext,
  NotImplementedError,
  wrapResponse,
} from './helpers'
import { mapNotification } from './mappers'

// =============================================
// Notifications
// =============================================

export async function getNotifications(
  ctx: MisskeyClientContext,
  options?: {
    limit?: number
    max_id?: string
    since_id?: string
    min_id?: string
    exclude_types?: Array<Entity.NotificationType>
    account_id?: string
  },
): Promise<Response<Array<Entity.Notification>>> {
  const notifications = await ctx.client.request('i/notifications', {
    limit: options?.limit ?? 20,
    ...(options?.max_id ? { untilId: options.max_id } : {}),
    ...(options?.since_id ? { sinceId: options.since_id } : {}),
  })
  return wrapResponse(notifications.map((n) => mapNotification(n, ctx.origin)))
}

export async function getNotification(
  ctx: MisskeyClientContext,
  id: string,
): Promise<Response<Entity.Notification>> {
  // Misskey doesn't have a single notification endpoint; fetch recent and filter
  const notifications = await ctx.client.request('i/notifications', {
    limit: 100,
  })
  const target = notifications.find((n) => n.id === id)
  if (target) {
    return wrapResponse(mapNotification(target, ctx.origin))
  }
  throw new NotImplementedError('getNotification')
}

export async function dismissNotifications(
  ctx: MisskeyClientContext,
): Promise<Response<Record<string, never>>> {
  await ctx.client.request('notifications/mark-all-as-read', {})
  return wrapResponse({} as Record<string, never>)
}

export async function dismissNotification(
  _id: string,
): Promise<Response<Record<string, never>>> {
  throw new NotImplementedError('dismissNotification')
}

export async function readNotifications(
  ctx: MisskeyClientContext,
  _options: {
    id?: string
    max_id?: string
  },
): Promise<Response<Record<string, never>>> {
  await ctx.client.request('notifications/mark-all-as-read', {})
  return wrapResponse({} as Record<string, never>)
}

// =============================================
// Push Subscriptions
// =============================================

export async function subscribePushNotification(
  _subscription: {
    endpoint: string
    keys: { p256dh: string; auth: string }
  },
  _data?: { alerts: Record<string, boolean> } | null,
): Promise<Response<Entity.PushSubscription>> {
  throw new NotImplementedError('subscribePushNotification')
}

export async function getPushSubscription(): Promise<
  Response<Entity.PushSubscription>
> {
  throw new NotImplementedError('getPushSubscription')
}

export async function updatePushSubscription(
  _data?: { alerts: Record<string, boolean> } | null,
): Promise<Response<Entity.PushSubscription>> {
  throw new NotImplementedError('updatePushSubscription')
}

export async function deletePushSubscription(): Promise<
  Response<Record<string, never>>
> {
  throw new NotImplementedError('deletePushSubscription')
}
