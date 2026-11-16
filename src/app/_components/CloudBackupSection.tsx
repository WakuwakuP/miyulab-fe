'use client'

import {
  authorizeSettingsBackup,
  createSettingsBackup,
  deleteSettingsBackup,
  getSettingsBackup,
  getSettingsBackupStatus,
  listSettingsBackups,
} from 'app/actions/settingsBackup.server'
import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { App } from 'types/types'
import { AppsContext } from 'util/provider/AppsProvider'
import { applySettingsBackup } from 'util/settingsBackup/applyBackup'
import { notifySettingsBackupRestored } from 'util/settingsBackup/channel'
import {
  SETTINGS_BACKUP_ERRORS,
  type SettingsBackupError,
} from 'util/settingsBackup/constants'
import { buildSettingsEnvelope } from 'util/settingsBackup/envelope'
import { normalizeSettingsBackupOrigin } from 'util/settingsBackup/origin'
import type { SettingsBackupSession } from 'util/settingsBackup/session'
import type { SettingsBackupSummary } from 'util/settingsBackup/store'

function accountOptionKey(app: App): string {
  const token = app.tokenData?.access_token ?? ''
  let hash = 0
  for (let index = 0; index < token.length; index += 1) {
    hash = (hash * 31 + token.charCodeAt(index)) | 0
  }
  return `${app.backend}:${app.backendUrl}:${hash}`
}

function signedInApps(apps: App[]): App[] {
  return apps.filter((app) => {
    const token = app.tokenData?.access_token
    return typeof token === 'string' && token.length > 0
  })
}

function restoreMessage(backup: SettingsBackupSummary): string {
  const saved = new Date(backup.createdAt).toLocaleString()
  return [
    'Restore this cloud backup?',
    `Saved: ${saved}`,
    `Timelines: ${backup.timelineCount}`,
    '',
    'Only sections included in the backup replace current settings. Access tokens are not included, and your logins stay as they are. Columns for servers you are not logged into on this browser remain in the layout and start working after you sign in.',
    '',
    "This backup is stored in plaintext in miyulab's database. Other open miyulab tabs will reload. This cannot be undone.",
  ].join('\n')
}

export function CloudBackupSection() {
  const apps = useContext(AppsContext)
  const accounts = useMemo(() => signedInApps(apps), [apps])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null)
  const [session, setSession] = useState<SettingsBackupSession | null>(null)
  const [backups, setBackups] = useState<SettingsBackupSummary[]>([])
  const [available, setAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SettingsBackupError | null>(null)

  const loadList = useCallback(async () => {
    const listed = await listSettingsBackups()
    if (!listed.success) {
      setError(listed.error)
      setBackups([])
      return
    }
    setBackups(listed.backups)
  }, [])

  useEffect(() => {
    let cancelled = false
    getSettingsBackupStatus()
      .then(async (status) => {
        if (cancelled) return
        if (!status.success) {
          setAvailable(false)
          setError(status.error)
          setLoading(false)
          return
        }
        setSession(status.session)
        if (status.session != null) await loadList()
        if (!cancelled) setLoading(false)
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
  }, [loadList])

  useEffect(() => {
    if (session == null) return
    const matches = accounts.flatMap((app, index) =>
      normalizeSettingsBackupOrigin(app.backendUrl) === session.backendUrl
        ? [index]
        : [],
    )
    if (matches.length === 1 && matches[0] != null) {
      setSelectedIndex(matches[0])
    }
  }, [accounts, session])

  const selected = accounts[selectedIndex] ?? null
  const selectedOrigin =
    selected == null ? null : normalizeSettingsBackupOrigin(selected.backendUrl)
  const canSave =
    session != null &&
    pinnedIndex === selectedIndex &&
    selectedOrigin != null &&
    session.backendUrl === selectedOrigin

  const showError = (next: SettingsBackupError) => {
    setError(next)
  }

  const authorize = async () => {
    if (selected?.tokenData?.access_token == null) return
    setBusy(true)
    setError(null)
    try {
      const result = await authorizeSettingsBackup(
        selected.backend,
        selected.backendUrl,
        selected.tokenData.access_token,
      )
      if (!result.success) {
        showError(result.error)
        return
      }
      setSession({
        accountId: result.accountId,
        acct: result.acct,
        backendUrl: result.backendUrl,
      })
      setPinnedIndex(selectedIndex)
      await loadList()
    } catch {
      showError(SETTINGS_BACKUP_ERRORS.unavailable)
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const built = buildSettingsEnvelope(
        (key) => localStorage.getItem(key),
        new Date().toISOString(),
      )
      if (!built.ok) {
        showError(built.error)
        return
      }
      const result = await createSettingsBackup(built.envelope)
      if (!result.success) {
        showError(result.error)
        return
      }
      await loadList()
    } catch {
      showError(SETTINGS_BACKUP_ERRORS.unavailable)
    } finally {
      setBusy(false)
    }
  }

  const restore = async (backup: SettingsBackupSummary) => {
    if (!confirm(restoreMessage(backup))) return
    setBusy(true)
    setError(null)
    try {
      const result = await getSettingsBackup(backup.id)
      if (!result.success) {
        showError(result.error)
        return
      }
      const applied = applySettingsBackup(result.envelope, {
        notifyOtherTabs: notifySettingsBackupRestored,
        reload: () => location.reload(),
        storage: localStorage,
      })
      if (!applied.ok) showError(applied.error)
    } catch {
      showError(SETTINGS_BACKUP_ERRORS.unavailable)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (backup: SettingsBackupSummary) => {
    if (!confirm('Delete this cloud backup? This cannot be undone.')) return
    setBusy(true)
    setError(null)
    try {
      const result = await deleteSettingsBackup(backup.id)
      if (!result.success) {
        showError(result.error)
        return
      }
      await loadList()
    } catch {
      showError(SETTINGS_BACKUP_ERRORS.unavailable)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 border-b border-gray-600 pb-4">
      <p className="mb-2 text-lg font-semibold text-gray-400">Cloud backup</p>
      <p className="mb-2 text-xs text-gray-400">
        Saves timeline layout and display settings for the authorized account.
        Access tokens are not included. The operator of this server can read the
        saved JSON.
      </p>
      {loading ? (
        <p className="text-sm text-gray-400">Loading cloud backup…</p>
      ) : null}
      {!loading && !available ? (
        <p className="text-sm text-gray-400">Cloud backup is unavailable.</p>
      ) : null}
      {!loading && available ? (
        <div className="space-y-2">
          {accounts.length === 0 ? (
            <p className="text-sm text-gray-400">
              Sign in to an account before saving a cloud backup.
            </p>
          ) : (
            <label className="flex items-center gap-2 text-sm">
              Account
              <select
                className="min-w-0 flex-1 bg-gray-800"
                onChange={(event) =>
                  setSelectedIndex(Number(event.target.value))
                }
                value={selectedIndex}
              >
                {accounts.map((app, index) => (
                  <option key={accountOptionKey(app)} value={index}>
                    {app.backend} · {app.backendUrl}
                  </option>
                ))}
              </select>
            </label>
          )}
          {session != null ? (
            <p className="text-sm text-gray-300">
              Authorized as {session.acct} · {session.backendUrl}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {accounts.length > 0 ? (
              <button
                className="rounded bg-gray-700 px-2 py-1 text-sm hover:bg-gray-600 disabled:opacity-50"
                disabled={busy || selected == null}
                onClick={() => void authorize()}
                type="button"
              >
                Authorize this account
              </button>
            ) : null}
            <button
              className="rounded bg-gray-700 px-2 py-1 text-sm hover:bg-gray-600 disabled:opacity-50"
              disabled={busy || !canSave}
              onClick={() => void save()}
              type="button"
            >
              Save current settings
            </button>
          </div>
          {session != null && backups.length === 0 ? (
            <p className="text-sm text-gray-400">No cloud backups yet.</p>
          ) : null}
          {backups.length > 0 ? (
            <ul className="space-y-2">
              {backups.map((backup) => (
                <li
                  className="flex flex-wrap items-center gap-2 text-sm"
                  key={backup.id}
                >
                  <span>
                    {new Date(backup.createdAt).toLocaleString()} ·{' '}
                    {backup.timelineCount} timelines
                  </span>
                  <button
                    className="rounded bg-gray-700 px-2 py-1 hover:bg-gray-600 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void restore(backup)}
                    type="button"
                  >
                    Restore
                  </button>
                  <button
                    className="rounded bg-red-900 px-2 py-1 hover:bg-red-800 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void remove(backup)}
                    type="button"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {error != null ? (
        <p className="mt-2 text-sm text-red-300">{error}</p>
      ) : null}
    </div>
  )
}
