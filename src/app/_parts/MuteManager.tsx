'use client'

import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { getSqliteDb, notifyChange } from 'util/db/sqlite/connection'
import { AppsContext } from 'util/provider/AppsProvider'

type MutedAccount = {
  account_acct: string
  muted_at: number
}

/**
 * ミュートアカウント一覧を取得する
 */
async function getMutedAccounts(backendUrl: string): Promise<MutedAccount[]> {
  const handle = await getSqliteDb()
  const rows = handle.db.exec(
    'SELECT account_acct, muted_at FROM muted_accounts WHERE backendUrl = ? ORDER BY muted_at DESC;',
    { bind: [backendUrl], returnValue: 'resultRows' },
  ) as (string | number)[][]

  return rows.map((row) => ({
    account_acct: row[0] as string,
    muted_at: row[1] as number,
  }))
}

/**
 * アカウントをミュートする
 */
async function muteAccount(
  backendUrl: string,
  accountAcct: string,
): Promise<void> {
  const handle = await getSqliteDb()
  handle.db.exec(
    `INSERT OR IGNORE INTO muted_accounts (backendUrl, account_acct, muted_at)
     VALUES (?, ?, ?);`,
    { bind: [backendUrl, accountAcct, Date.now()] },
  )
  notifyChange('statuses') // タイムラインの再クエリをトリガー
}

/**
 * アカウントのミュートを解除する
 */
async function unmuteAccount(
  backendUrl: string,
  accountAcct: string,
): Promise<void> {
  const handle = await getSqliteDb()
  handle.db.exec(
    'DELETE FROM muted_accounts WHERE backendUrl = ? AND account_acct = ?;',
    { bind: [backendUrl, accountAcct] },
  )
  notifyChange('statuses')
}

/**
 * ミュートアカウント管理コンポーネント
 *
 * muted_accounts テーブルを直接操作して、
 * 指定バックエンドのミュートアカウントの一覧表示・追加・削除を行う。
 */
export function MuteManager({ onClose }: { onClose: () => void }) {
  const apps = useContext(AppsContext)
  const [selectedBackendUrl, setSelectedBackendUrl] = useState<string>(
    apps[0]?.backendUrl ?? '',
  )
  const [mutedAccounts, setMutedAccounts] = useState<MutedAccount[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const fetchMutedAccounts = useCallback(async () => {
    if (!selectedBackendUrl) return
    setIsLoading(true)
    try {
      const accounts = await getMutedAccounts(selectedBackendUrl)
      setMutedAccounts(accounts)
    } catch (e) {
      console.error('Failed to fetch muted accounts:', e)
    } finally {
      setIsLoading(false)
    }
  }, [selectedBackendUrl])

  useEffect(() => {
    fetchMutedAccounts()
  }, [fetchMutedAccounts])

  const handleMute = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || !selectedBackendUrl) return
    try {
      await muteAccount(selectedBackendUrl, trimmed)
      setInput('')
      await fetchMutedAccounts()
    } catch (e) {
      console.error('Failed to mute account:', e)
    }
  }, [input, selectedBackendUrl, fetchMutedAccounts])

  const handleUnmute = useCallback(
    async (acct: string) => {
      if (!selectedBackendUrl) return
      try {
        await unmuteAccount(selectedBackendUrl, acct)
        await fetchMutedAccounts()
      } catch (e) {
        console.error('Failed to unmute account:', e)
      }
    },
    [selectedBackendUrl, fetchMutedAccounts],
  )

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }

  const dialogRef = useRef<HTMLDivElement>(null)

  // Escape キーでモーダルを閉じる
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // モーダル表示時にフォーカスを移動
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  return (
    <div
      aria-label="Muted Accounts"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
    >
      <div
        className="w-full max-w-md rounded-lg border border-gray-600 bg-gray-800 p-4 shadow-xl outline-none"
        ref={dialogRef}
        tabIndex={-1}
      >
        <h3 className="mb-3 text-sm font-semibold text-gray-200">
          Muted Accounts
        </h3>
        {/* Backend selector */}
        {apps.length > 1 && (
          <div className="mb-3">
            <label className="text-xs text-gray-400" htmlFor="mute-backend">
              Backend
            </label>
            <select
              className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-white"
              id="mute-backend"
              onChange={(e) => setSelectedBackendUrl(e.target.value)}
              value={selectedBackendUrl}
            >
              {apps.map((app) => (
                <option key={app.backendUrl} value={app.backendUrl}>
                  {app.backendUrl}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-3 flex gap-1">
          <input
            className="flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-white"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleMute()
              }
            }}
            placeholder="user@instance.tld"
            type="text"
            value={input}
          />
          <button
            className="rounded bg-red-700 px-3 py-1 text-xs hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-gray-600"
            disabled={!input.trim()}
            onClick={handleMute}
            type="button"
          >
            Mute
          </button>
        </div>
        {/* List */}
        <div className="max-h-60 overflow-y-auto">
          {isLoading ? (
            <p className="py-4 text-center text-xs text-gray-500">Loading...</p>
          ) : mutedAccounts.length === 0 ? (
            <p className="py-4 text-center text-xs text-gray-500">
              No muted accounts
            </p>
          ) : (
            <ul className="space-y-1">
              {mutedAccounts.map((account) => (
                <li
                  className="flex items-center justify-between rounded border border-slate-700 px-2 py-1.5"
                  key={account.account_acct}
                >
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-white">
                      @{account.account_acct}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatDate(account.muted_at)}
                    </span>
                  </div>
                  <button
                    className="ml-2 shrink-0 rounded border border-slate-600 px-2 py-0.5 text-xs text-gray-300 hover:bg-slate-700 hover:text-white"
                    onClick={() => handleUnmute(account.account_acct)}
                    type="button"
                  >
                    Unmute
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {/* Close */}
        <div className="mt-3 flex justify-end">
          <button
            className="rounded bg-gray-600 px-3 py-1 text-xs hover:bg-gray-500"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export { muteAccount }
