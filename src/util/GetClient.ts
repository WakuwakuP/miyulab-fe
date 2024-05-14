import generator from 'megalodon'

import { type App } from './provider/AppsProvider'

export const GetClient = (app: App) => {
  const { backend, backendUrl, tokenData } = app
  return generator(
    backend,
    backendUrl,
    tokenData?.access_token
  )
}
