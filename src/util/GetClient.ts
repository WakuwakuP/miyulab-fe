import type { MegalodonInterface } from 'megalodon'
import generator from 'megalodon'

import type { App } from 'types/types'
import { MisskeyAdapter } from './misskey/MisskeyAdapter'
import { decoratePleromaNotifications } from './notificationReadApi'

export const GetClient = (app: App): MegalodonInterface => {
  const { backend, backendUrl, tokenData } = app
  if (backend === 'misskey') {
    return new MisskeyAdapter(backendUrl, tokenData?.access_token)
  }
  const client = generator(backend, backendUrl, tokenData?.access_token)
  if (backend === 'pleroma') {
    const getNotifications = client.getNotifications.bind(client)
    const getNotification = client.getNotification.bind(client)
    client.getNotifications = async (options) => {
      const response = await getNotifications(options)
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(options ?? {})) {
        if (value === undefined) continue
        if (Array.isArray(value))
          value.forEach((item) => {
            params.append(`${key}[]`, String(item))
          })
        else params.set(key, String(value))
      }
      return {
        ...response,
        data: await decoratePleromaNotifications(app, response.data, params),
      }
    }
    client.getNotification = async (id) => {
      const response = await getNotification(id)
      const [data] = await decoratePleromaNotifications(
        app,
        [response.data],
        undefined,
        id,
      )
      return { ...response, data }
    }
  }
  return client
}
