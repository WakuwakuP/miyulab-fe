export function compareNotificationIds(a: string, b: string): number | null {
  if (a === b) return 0
  if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return null
  const left = BigInt(a)
  const right = BigInt(b)
  if (left < right) return -1
  return left > right ? 1 : 0
}

export function notificationReadState(
  id: string,
  boundary: string | null,
): boolean | null {
  if (!boundary) return null
  const order = compareNotificationIds(id, boundary)
  return order === null ? null : order <= 0
}

export type NotificationReadUpdate = {
  id: string
  isRead: boolean
}

export type NotificationReadMutation = {
  backendUrl: string
  localAccountId: number
  remoteAccountId: string
  boundary?: string
  updates?: NotificationReadUpdate[]
}
