import type { Response } from 'megalodon'
import type * as Misskey from 'misskey-js'

export type MisskeyClientContext = {
  client: Misskey.api.APIClient
  origin: string
  credential: string | null
}

export function wrapResponse<T>(data: T, status = 200): Response<T> {
  return {
    data,
    headers: {},
    status,
    statusText: 'OK',
  }
}

export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`MisskeyAdapter: ${method} is not implemented`)
    this.name = 'NotImplementedError'
  }
}
