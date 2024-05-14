import { type OAuth } from 'megalodon'

export type App = {
  backend: Backend
  backendUrl: string
  appData: OAuth.AppData
  tokenData: OAuth.TokenData | null
}

export const backendList = [
  'mastodon',
  'pleroma',
  'friendica',
  'firefish',
] as const

export type Backend = (typeof backendList)[number]
