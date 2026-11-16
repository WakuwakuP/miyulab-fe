import { fn } from 'storybook/test'
import { apps } from '../../src/stories/support/fixtures'
import { client } from './client'
export const detector = fn(async () => 'mastodon')
export const detectMisskey = fn(async () => false)
export const fetchMiAuthToken = fn(async () => null)
export const createMiAuthAppData = fn(() => apps[0].appData)
const registrationClient = {
  ...client,
  registerApp: fn(async () => apps[0].appData),
}
export default function generator() {
  return registrationClient
}
export class MisskeyAdapter {
  registerApp = registrationClient.registerApp
}
