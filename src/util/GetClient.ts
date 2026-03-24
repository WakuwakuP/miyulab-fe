import type { MegalodonInterface } from 'megalodon'
import generator from 'megalodon'

import type { App } from 'types/types'
import { MisskeyAdapter } from './misskey/MisskeyAdapter'

export const GetClient = (app: App): MegalodonInterface => {
  const { backend, backendUrl, tokenData } = app
  if (backend === 'misskey') {
    return new MisskeyAdapter(backendUrl, tokenData?.access_token)
  }
  return generator(backend, backendUrl, tokenData?.access_token)
}
