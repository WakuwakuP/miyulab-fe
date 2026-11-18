import type { Entity } from 'megalodon'
import type { App } from 'types/types'
import { GetClient } from 'util/GetClient'

const accounts = new WeakMap<App, Promise<Entity.Account>>()

export function verifyLogin(app: App): Promise<Entity.Account> {
  const existing = accounts.get(app)
  if (existing) return existing
  const request = GetClient(app)
    .verifyAccountCredentials()
    .then(({ data }) => data)
    .catch((error) => {
      accounts.delete(app)
      throw error
    })
  accounts.set(app, request)
  return request
}
