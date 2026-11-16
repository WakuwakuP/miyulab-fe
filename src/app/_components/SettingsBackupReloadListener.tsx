'use client'

import { useEffect } from 'react'
import { SETTINGS_BACKUP_CHANNEL } from 'util/settingsBackup/constants'

export function SettingsBackupReloadListener() {
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(SETTINGS_BACKUP_CHANNEL)
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (
        typeof event.data === 'object' &&
        event.data != null &&
        'type' in event.data &&
        event.data.type === 'restored'
      ) {
        location.reload()
      }
    }
    return () => channel.close()
  }, [])
  return null
}
