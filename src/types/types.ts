import { type Entity, type OAuth } from 'megalodon'

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

export type StatusAddAppIndex = Entity.Status & {
  appIndex: number
}

export type NotificationAddAppIndex =
  Entity.Notification & {
    appIndex: number
  }

export type AccountAddAppIndex = Entity.Account & {
  appIndex: number
}

export type PollAddAppIndex = Entity.Poll & {
  appIndex: number
}
