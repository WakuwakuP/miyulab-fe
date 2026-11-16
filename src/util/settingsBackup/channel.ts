import { SETTINGS_BACKUP_CHANNEL } from './constants'

export function notifySettingsBackupRestored(): void {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(SETTINGS_BACKUP_CHANNEL)
  channel.postMessage({ type: 'restored' })
  channel.close()
}
