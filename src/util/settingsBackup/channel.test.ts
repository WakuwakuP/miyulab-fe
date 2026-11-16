import { afterEach, describe, expect, it, vi } from 'vitest'
import { notifySettingsBackupRestored } from './channel'
import { SETTINGS_BACKUP_CHANNEL } from './constants'

describe('notifySettingsBackupRestored', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('復元を他タブへ通知する', () => {
    const close = vi.fn()
    const postMessage = vi.fn()
    const names: string[] = []
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        constructor(name: string) {
          names.push(name)
        }
        close = close
        postMessage = postMessage
      },
    )

    notifySettingsBackupRestored()

    expect(names).toEqual([SETTINGS_BACKUP_CHANNEL])
    expect(postMessage).toHaveBeenCalledWith({ type: 'restored' })
    expect(close).toHaveBeenCalledOnce()
  })

  it('BroadcastChannel が無い環境では何もしない', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    expect(() => notifySettingsBackupRestored()).not.toThrow()
  })
})
