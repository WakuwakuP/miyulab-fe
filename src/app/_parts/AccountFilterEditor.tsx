'use client'

import { useState } from 'react'
import type { AccountFilter, AccountFilterMode } from 'types/types'

export function AccountFilterEditor({
  onChange,
  value,
}: {
  onChange: (filter: AccountFilter | undefined) => void
  value: AccountFilter | undefined
}) {
  const [input, setInput] = useState('')
  const mode: AccountFilterMode = value?.mode ?? 'exclude'
  const accts = value?.accts ?? []

  const addAccount = (acct: string) => {
    const trimmed = acct.trim()
    if (trimmed && !accts.includes(trimmed)) {
      onChange({ accts: [...accts, trimmed], mode })
    }
    setInput('')
  }

  const removeAccount = (acct: string) => {
    const next = accts.filter((a) => a !== acct)
    onChange(next.length > 0 ? { accts: next, mode } : undefined)
  }

  const toggleMode = (newMode: AccountFilterMode) => {
    if (accts.length > 0) {
      onChange({ accts, mode: newMode })
    }
  }

  return (
    <div className="space-y-1">
      <span className="text-xs text-gray-400">Account Filter</span>
      {/* モード切替（アカウントが1つ以上ある場合のみ表示） */}
      {accts.length > 0 && (
        <div className="flex gap-2">
          <label className="flex items-center gap-1 text-xs cursor-pointer">
            <input
              checked={mode === 'include'}
              name="accountFilterMode"
              onChange={() => toggleMode('include')}
              type="radio"
            />
            Include only
          </label>
          <label className="flex items-center gap-1 text-xs cursor-pointer">
            <input
              checked={mode === 'exclude'}
              name="accountFilterMode"
              onChange={() => toggleMode('exclude')}
              type="radio"
            />
            Exclude
          </label>
        </div>
      )}
      {/* アカウント一覧 */}
      {accts.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {accts.map((acct) => (
            <span
              className="inline-flex items-center gap-1 rounded bg-slate-700 px-2 py-0.5 text-xs"
              key={acct}
            >
              @{acct}
              <button
                className="text-gray-400 hover:text-white"
                onClick={() => removeAccount(acct)}
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {/* 入力欄 */}
      <div className="flex gap-1">
        <input
          className="flex-1 rounded bg-gray-700 px-2 py-1 text-xs text-white"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addAccount(input)
            }
          }}
          placeholder="user@instance.tld"
          type="text"
          value={input}
        />
        <button
          className="rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-700"
          onClick={() => addAccount(input)}
          type="button"
        >
          +
        </button>
      </div>
    </div>
  )
}
