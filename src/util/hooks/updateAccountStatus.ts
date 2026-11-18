import type { Entity } from 'megalodon'

export function updateAccountStatus<T extends Entity.Status>(
  status: T,
  statusId: string,
  updates: Partial<Entity.Status>,
) {
  if (status.id !== statusId && status.reblog?.id !== statusId) return status
  return {
    ...status,
    ...updates,
    reblog:
      status.reblog?.id === statusId
        ? { ...status.reblog, ...updates }
        : status.reblog,
  }
}
