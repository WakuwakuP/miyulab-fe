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
  'gotosocial',
  'pixelfed',
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

export type TimelineType =
  | 'home'
  | 'local'
  | 'public'
  | 'notification'
  | 'tag'

export type TimelineConfig = {
  id: string
  type: TimelineType
  visible: boolean
  order: number
  tag?: string // Only used for tag timelines
}

export type TimelineSettings = {
  timelines: TimelineConfig[]
}
