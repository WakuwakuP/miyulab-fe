'use client'

import { useState } from 'react'

const LANGUAGE_PRESETS = [
  { code: 'ja', label: '日本語' },
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
  { code: 'ko', label: '한국어' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
]

export function LanguageFilter({
  onChange,
  value,
}: {
  onChange: (filter: string[] | undefined) => void
  value: string[] | undefined
}) {
  const [input, setInput] = useState('')
  const languages = value ?? []

  const addLanguage = (code: string) => {
    const trimmed = code.trim().toLowerCase()
    if (trimmed && !languages.includes(trimmed)) {
      onChange([...languages, trimmed])
    }
    setInput('')
  }

  const removeLanguage = (code: string) => {
    const next = languages.filter((l) => l !== code)
    onChange(next.length > 0 ? next : undefined)
  }

  return (
    <div className="space-y-1">
      <span className="text-xs text-gray-400">Language</span>
      {/* 選択済み言語のタグ表示 */}
      {languages.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {languages.map((lang) => (
            <span
              className="inline-flex items-center gap-1 rounded bg-slate-700 px-2 py-0.5 text-xs"
              key={lang}
            >
              {lang}
              <button
                className="text-gray-400 hover:text-white"
                onClick={() => removeLanguage(lang)}
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {/* プリセットボタン */}
      <div className="flex flex-wrap gap-1">
        {LANGUAGE_PRESETS.filter((p) => !languages.includes(p.code)).map(
          (preset) => (
            <button
              className="rounded border border-slate-600 px-2 py-0.5 text-xs hover:bg-slate-700"
              key={preset.code}
              onClick={() => addLanguage(preset.code)}
              type="button"
            >
              {preset.label}
            </button>
          ),
        )}
      </div>
      {/* カスタム入力 */}
      <div className="flex gap-1">
        <input
          className="flex-1 rounded bg-gray-700 px-2 py-1 text-xs text-white"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addLanguage(input)
            }
          }}
          placeholder="Language code (e.g. ja)"
          type="text"
          value={input}
        />
        <button
          className="rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-700"
          onClick={() => addLanguage(input)}
          type="button"
        >
          +
        </button>
      </div>
    </div>
  )
}
