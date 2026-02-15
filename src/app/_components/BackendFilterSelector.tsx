'use client'

import { useContext, useMemo } from 'react'
import type { BackendFilter } from 'types/types'
import { AppsContext } from 'util/provider/AppsProvider'

type BackendFilterSelectorProps = {
  onChange: (filter: BackendFilter) => void
  value: BackendFilter
}

export const BackendFilterSelector = ({
  onChange,
  value,
}: BackendFilterSelectorProps) => {
  const apps = useContext(AppsContext)

  const backendOptions = useMemo(
    () =>
      apps.map((app) => {
        let hostname: string
        try {
          hostname = new URL(app.backendUrl).hostname
        } catch {
          hostname = app.backendUrl
        }
        return {
          hostname,
          url: app.backendUrl,
        }
      }),
    [apps],
  )

  // 単一アカウント時は選択肢を表示しない
  if (apps.length <= 1) {
    return (
      <div className="text-xs text-gray-400">
        Single account — all timelines use this account
      </div>
    )
  }

  const handleModeChange = (mode: BackendFilter['mode']) => {
    switch (mode) {
      case 'all':
        onChange({ mode: 'all' })
        break
      case 'single':
        onChange({
          backendUrl: apps[0].backendUrl,
          mode: 'single',
        })
        break
      case 'composite':
        onChange({
          backendUrls: apps.map((a) => a.backendUrl),
          mode: 'composite',
        })
        break
    }
  }

  const handleSingleChange = (backendUrl: string) => {
    onChange({ backendUrl, mode: 'single' })
  }

  const handleCompositeToggle = (backendUrl: string) => {
    if (value.mode !== 'composite') return

    const current = value.backendUrls
    const isSelected = current.includes(backendUrl)

    if (isSelected) {
      const updated = current.filter((url) => url !== backendUrl)
      // 0個になる場合は all にフォールバック
      if (updated.length === 0) {
        onChange({ mode: 'all' })
      } else if (updated.length === 1) {
        // 1個になる場合は single に正規化
        onChange({ backendUrl: updated[0], mode: 'single' })
      } else {
        onChange({ backendUrls: [...updated].sort(), mode: 'composite' })
      }
    } else {
      const updated = [...current, backendUrl].sort()
      onChange({ backendUrls: updated, mode: 'composite' })
    }
  }

  return (
    <div className="space-y-2">
      <span className="text-xs font-semibold text-gray-300">
        Backend Filter
      </span>

      <div className="flex space-x-1">
        {(['all', 'single', 'composite'] as const).map((mode) => (
          <button
            className={`rounded px-2 py-1 text-xs ${
              value.mode === mode
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
            key={mode}
            onClick={() => handleModeChange(mode)}
            type="button"
          >
            {mode === 'all' ? 'All' : mode === 'single' ? 'Single' : 'Custom'}
          </button>
        ))}
      </div>

      {value.mode === 'single' && (
        <div className="space-y-1">
          {backendOptions.map((opt) => (
            <label
              className="flex items-center space-x-2 cursor-pointer text-sm"
              key={opt.url}
            >
              <input
                checked={value.backendUrl === opt.url}
                className="cursor-pointer"
                name="backendFilterSingle"
                onChange={() => handleSingleChange(opt.url)}
                type="radio"
              />
              <span>{opt.hostname}</span>
            </label>
          ))}
        </div>
      )}

      {value.mode === 'composite' && (
        <div className="space-y-1">
          {backendOptions.map((opt) => (
            <label
              className="flex items-center space-x-2 cursor-pointer text-sm"
              key={opt.url}
            >
              <input
                checked={value.backendUrls.includes(opt.url)}
                className="cursor-pointer"
                onChange={() => handleCompositeToggle(opt.url)}
                type="checkbox"
              />
              <span>{opt.hostname}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
