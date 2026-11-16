'use client'

import {
  authorizeSettingsBackup,
  createSettingsBackup,
  getSettingsBackup,
  getSettingsBackupStatus,
  listSettingsBackups,
} from 'app/actions/settingsBackup.server'
import { useContext, useEffect, useRef, useState } from 'react'
import type { App } from 'types/types'
import { AppsContext } from 'util/provider/AppsProvider'
import { applySettingsBackup } from 'util/settingsBackup/applyBackup'
import { notifySettingsBackupRestored } from 'util/settingsBackup/channel'
import {
  SETTINGS_BACKUP_ERRORS,
  type SettingsBackupError,
} from 'util/settingsBackup/constants'
import { buildSettingsEnvelope } from 'util/settingsBackup/envelope'
import type { SettingsBackupSummary } from 'util/settingsBackup/store'

function firstAccount(apps: App[]): App | null {
  const app = apps[0]
  const token = app?.tokenData?.access_token
  if (app == null || typeof token !== 'string' || token.length === 0)
    return null
  return app
}

function newestFirst(
  backups: SettingsBackupSummary[],
): SettingsBackupSummary[] {
  return [...backups].sort(
    (left, right) =>
      Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
      right.id.localeCompare(left.id),
  )
}

export function CloudBackupSection() {
  const apps = useContext(AppsContext)
  const targetApp = firstAccount(apps)
  const restoreDialogRef = useRef<HTMLDialogElement>(null)
  const authorizedToken = useRef<string | null>(null)
  const [backups, setBackups] = useState<SettingsBackupSummary[]>([])
  const [available, setAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SettingsBackupError | null>(null)
  const [restoreOpen, setRestoreOpen] = useState(false)

  const showError = (next: SettingsBackupError) => {
    if (next === SETTINGS_BACKUP_ERRORS.authorizationFailed)
      authorizedToken.current = null
    setError(next)
  }

  useEffect(() => {
    const dialog = restoreDialogRef.current
    if (dialog == null) return
    const onClose = () => setRestoreOpen(false)
    dialog.addEventListener('close', onClose)
    return () => dialog.removeEventListener('close', onClose)
  }, [])

  useEffect(() => {
    const dialog = restoreDialogRef.current
    if (dialog == null) return
    if (restoreOpen && !dialog.open) dialog.showModal()
    if (!restoreOpen && dialog.open) dialog.close()
  }, [restoreOpen])

  useEffect(() => {
    let cancelled = false
    getSettingsBackupStatus()
      .then((status) => {
        if (cancelled) return
        if (!status.success) {
          setAvailable(false)
          setError(status.error)
          setLoading(false)
          return
        }
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setAvailable(false)
        setError(SETTINGS_BACKUP_ERRORS.unavailable)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const ensureSession = async (app: App): Promise<boolean> => {
    const token = app.tokenData?.access_token
    if (token == null) return false
    if (authorizedToken.current === token) return true
    const result = await authorizeSettingsBackup(
      app.backend,
      app.backendUrl,
      token,
    )
    if (!result.success) {
      showError(result.error)
      return false
    }
    authorizedToken.current = token
    return true
  }

  const backup = async () => {
    if (targetApp == null) return
    setBusy(true)
    setError(null)
    try {
      if (!(await ensureSession(targetApp))) return
      const built = buildSettingsEnvelope(
        (key) => localStorage.getItem(key),
        new Date().toISOString(),
      )
      if (!built.ok) {
        showError(built.error)
        return
      }
      const result = await createSettingsBackup(built.envelope)
      if (!result.success) showError(result.error)
    } catch {
      showError(SETTINGS_BACKUP_ERRORS.unavailable)
    } finally {
      setBusy(false)
    }
  }

  const openRestore = async () => {
    if (targetApp == null) return
    setBusy(true)
    setError(null)
    try {
      if (!(await ensureSession(targetApp))) return
      const listed = await listSettingsBackups()
      if (!listed.success) {
        showError(listed.error)
        return
      }
      setBackups(newestFirst(listed.backups))
      setRestoreOpen(true)
    } catch {
      showError(SETTINGS_BACKUP_ERRORS.unavailable)
    } finally {
      setBusy(false)
    }
  }

  const restore = async (backupItem: SettingsBackupSummary) => {
    if (targetApp == null) return
    setBusy(true)
    setError(null)
    try {
      if (!(await ensureSession(targetApp))) return
      const result = await getSettingsBackup(backupItem.id)
      if (!result.success) {
        showError(result.error)
        return
      }
      const applied = applySettingsBackup(result.envelope, {
        notifyOtherTabs: notifySettingsBackupRestored,
        reload: () => location.reload(),
        storage: localStorage,
      })
      if (!applied.ok) {
        showError(applied.error)
        return
      }
      setRestoreOpen(false)
    } catch {
      showError(SETTINGS_BACKUP_ERRORS.unavailable)
    } finally {
      setBusy(false)
    }
  }

  const orderedBackups = newestFirst(backups)
  const buttonsDisabled = busy || loading || !available || targetApp == null

  return (
    <div className="mb-4 border-b border-gray-600 pb-4">
      <style>{`
        .settings-backup-dialog:modal { overscroll-behavior: contain; }
        .settings-backup-dialog::backdrop {
          overflow: hidden;
          overscroll-behavior: contain;
          background: rgb(0 0 0 / 0.6);
        }
      `}</style>
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded bg-slate-600 px-2 py-1 text-xs hover:bg-slate-500 disabled:opacity-50"
          disabled={buttonsDisabled}
          onClick={() => void backup()}
          type="button"
        >
          Backup
        </button>
        <button
          className="rounded bg-slate-600 px-2 py-1 text-xs hover:bg-slate-500 disabled:opacity-50"
          disabled={buttonsDisabled}
          onClick={() => void openRestore()}
          type="button"
        >
          Restore
        </button>
      </div>
      {!loading && !available ? (
        <p className="mt-2 text-sm text-gray-400">
          Cloud backup is unavailable.
        </p>
      ) : null}
      {!loading && available && targetApp == null ? (
        <p className="mt-2 text-sm text-gray-400">
          Sign in to the first account before using cloud backup.
        </p>
      ) : null}
      {error != null ? (
        <p className="mt-2 text-sm text-red-300">{error}</p>
      ) : null}
      <dialog
        aria-labelledby="settings-backup-restore-title"
        className="settings-backup-dialog m-auto w-[min(24rem,calc(100vw-2rem))] rounded-md border border-gray-600 bg-gray-900 p-4 text-gray-100"
        closedby="any"
        ref={restoreDialogRef}
      >
        <h2
          className="mb-3 text-base font-semibold"
          id="settings-backup-restore-title"
        >
          Restore
        </h2>
        {orderedBackups.length === 0 ? (
          <p className="text-sm text-gray-400">No cloud backups yet.</p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto overscroll-contain">
            {orderedBackups.map((item) => (
              <li key={item.id}>
                <button
                  className="w-full rounded px-2 py-2 text-left text-sm hover:bg-gray-800 disabled:opacity-50"
                  disabled={busy || targetApp == null}
                  onClick={() => void restore(item)}
                  type="button"
                >
                  {new Date(item.createdAt).toLocaleString()}
                  <span className="mt-0.5 block text-xs text-gray-400">
                    {item.timelineCount} timelines
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="mt-3" method="dialog">
          <button
            className="rounded bg-slate-600 px-2 py-1 text-xs hover:bg-slate-500"
            type="submit"
            value="cancel"
          >
            Close
          </button>
        </form>
      </dialog>
    </div>
  )
}
