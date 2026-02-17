'use client'

import { useState } from 'react'
import type {
  AccountFilter,
  AccountFilterMode,
  NotificationType,
  StatusTimelineType,
  TimelineConfigV2,
  VisibilityType,
} from 'types/types'

// ========================================
// Props
// ========================================

type FilterControlsProps = {
  config: TimelineConfigV2
  onChange: (updates: Partial<TimelineConfigV2>) => void
}

// ========================================
// Visibility Filter
// ========================================

const VISIBILITY_OPTIONS: { label: string; value: VisibilityType }[] = [
  { label: 'Public', value: 'public' },
  { label: 'Unlisted', value: 'unlisted' },
  { label: 'Private', value: 'private' },
  { label: 'Direct', value: 'direct' },
]

function VisibilityFilter({
  onChange,
  value,
}: {
  onChange: (filter: VisibilityType[] | undefined) => void
  value: VisibilityType[] | undefined
}) {
  // 未設定 = 全て選択状態
  const selected: VisibilityType[] = value ?? [
    'public',
    'unlisted',
    'private',
    'direct',
  ]

  const toggle = (v: VisibilityType) => {
    const next = selected.includes(v)
      ? selected.filter((s) => s !== v)
      : [...selected, v]

    // 全て選択 or 全て未選択 → undefined（フィルタなし）
    if (next.length === 0 || next.length === 4) {
      onChange(undefined)
    } else {
      onChange(next)
    }
  }

  return (
    <div className="space-y-1">
      <span className="text-xs text-gray-400">Visibility</span>
      <div className="flex flex-wrap gap-2">
        {VISIBILITY_OPTIONS.map((opt) => (
          <label
            className="flex items-center gap-1 text-xs cursor-pointer"
            key={opt.value}
          >
            <input
              checked={selected.includes(opt.value)}
              className="cursor-pointer"
              onChange={() => toggle(opt.value)}
              type="checkbox"
            />
            {opt.label}
          </label>
        ))}
      </div>
    </div>
  )
}

// ========================================
// Language Filter
// ========================================

const LANGUAGE_PRESETS = [
  { code: 'ja', label: '日本語' },
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
  { code: 'ko', label: '한국어' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
]

function LanguageFilter({
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
          className="flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs"
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

// ========================================
// Toggle Filters
// ========================================

const TOGGLE_FILTERS: {
  description: string
  key: keyof Pick<
    TimelineConfigV2,
    'excludeReblogs' | 'excludeReplies' | 'excludeSensitive' | 'excludeSpoiler'
  >
  label: string
}[] = [
  {
    description: 'Hide boosted posts',
    key: 'excludeReblogs',
    label: 'Exclude Reblogs',
  },
  {
    description: 'Show only top-level posts',
    key: 'excludeReplies',
    label: 'Exclude Replies',
  },
  {
    description: 'Hide posts with Content Warning',
    key: 'excludeSpoiler',
    label: 'Exclude CW',
  },
  {
    description: 'Hide sensitive posts',
    key: 'excludeSensitive',
    label: 'Exclude Sensitive',
  },
]

function ToggleFilters({
  config,
  onChange,
}: {
  config: TimelineConfigV2
  onChange: (updates: Partial<TimelineConfigV2>) => void
}) {
  return (
    <div className="space-y-1">
      {TOGGLE_FILTERS.map((filter) => (
        <label
          className="flex items-center justify-between gap-2 text-xs cursor-pointer"
          key={filter.key}
        >
          <div>
            <span>{filter.label}</span>
            <span className="ml-2 text-gray-500">{filter.description}</span>
          </div>
          <input
            checked={config[filter.key] ?? false}
            className="cursor-pointer"
            onChange={(e) => onChange({ [filter.key]: e.target.checked })}
            type="checkbox"
          />
        </label>
      ))}
    </div>
  )
}

// ========================================
// Account Filter Editor
// ========================================

function AccountFilterEditor({
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
          className="flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs"
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

// ========================================
// Notification Type Filter
// ========================================

const NOTIFICATION_TYPE_OPTIONS: {
  label: string
  value: NotificationType
}[] = [
  { label: '👤 Follow', value: 'follow' },
  { label: '👤❓ Follow Request', value: 'follow_request' },
  { label: '💬 Mention', value: 'mention' },
  { label: '🔁 Reblog', value: 'reblog' },
  { label: '⭐ Favourite', value: 'favourite' },
  { label: '😀 Reaction', value: 'reaction' },
  { label: '📊 Poll Expired', value: 'poll_expired' },
  { label: '📝 Status', value: 'status' },
]

function NotificationTypeFilter({
  onChange,
  value,
}: {
  onChange: (filter: NotificationType[] | undefined) => void
  value: NotificationType[] | undefined
}) {
  // 未設定 = 全てオフ状態（通知を取得しない）
  const selected: NotificationType[] = value ?? []

  const allTypes = NOTIFICATION_TYPE_OPTIONS.map((o) => o.value)

  const toggle = (v: NotificationType) => {
    const next = selected.includes(v)
      ? selected.filter((s) => s !== v)
      : [...selected, v]

    // 空配列 → undefined（通知なし）
    if (next.length === 0) {
      onChange(undefined)
    } else {
      onChange(next)
    }
  }

  const toggleAll = () => {
    if (selected.length === allTypes.length) {
      // 全選択 → 全解除
      onChange(undefined)
    } else {
      // 一部選択 or 全解除 → 全選択
      onChange([...allTypes])
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">Notification Types</span>
        <button
          className="text-xs text-gray-500 hover:text-gray-300"
          onClick={toggleAll}
          type="button"
        >
          {selected.length === allTypes.length ? 'Deselect All' : 'Select All'}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {NOTIFICATION_TYPE_OPTIONS.map((opt) => (
          <label
            className="flex items-center gap-1 text-xs cursor-pointer"
            key={opt.value}
          >
            <input
              checked={selected.includes(opt.value)}
              className="cursor-pointer"
              onChange={() => toggle(opt.value)}
              type="checkbox"
            />
            {opt.label}
          </label>
        ))}
      </div>
    </div>
  )
}

// ========================================
// Media Filter Controls (enhanced)
// ========================================

function MediaFilterControls({
  config,
  onChange,
}: {
  config: TimelineConfigV2
  onChange: (updates: Partial<TimelineConfigV2>) => void
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center space-x-2 cursor-pointer text-xs">
        <input
          checked={config.onlyMedia ?? false}
          className="cursor-pointer"
          onChange={(e) => onChange({ onlyMedia: e.target.checked })}
          type="checkbox"
        />
        <span>📷 Only Media</span>
      </label>
      <div className="flex items-center gap-2 text-xs">
        <label htmlFor="minMediaCount">Min count:</label>
        <input
          className="w-16 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs"
          id="minMediaCount"
          max={20}
          min={0}
          onChange={(e) => {
            const val = Number.parseInt(e.target.value, 10)
            onChange({
              minMediaCount: Number.isNaN(val) || val <= 0 ? undefined : val,
            })
          }}
          placeholder="0"
          type="number"
          value={config.minMediaCount ?? ''}
        />
      </div>
    </div>
  )
}

// ========================================
// Mute / Block Controls
// ========================================

function MuteBlockControls({
  config,
  onChange,
  onOpenBlockManager,
  onOpenMuteManager,
}: {
  config: TimelineConfigV2
  onChange: (updates: Partial<TimelineConfigV2>) => void
  onOpenBlockManager: () => void
  onOpenMuteManager: () => void
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input
          checked={config.applyMuteFilter ?? true}
          className="cursor-pointer"
          onChange={(e) => onChange({ applyMuteFilter: e.target.checked })}
          type="checkbox"
        />
        Apply Mute Filter
      </label>
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input
          checked={config.applyInstanceBlock ?? true}
          className="cursor-pointer"
          onChange={(e) => onChange({ applyInstanceBlock: e.target.checked })}
          type="checkbox"
        />
        Apply Instance Block
      </label>
      <div className="flex gap-2">
        <button
          className="rounded border border-slate-600 px-3 py-1 text-xs hover:bg-slate-700"
          onClick={onOpenMuteManager}
          type="button"
        >
          Manage Mutes
        </button>
        <button
          className="rounded border border-slate-600 px-3 py-1 text-xs hover:bg-slate-700"
          onClick={onOpenBlockManager}
          type="button"
        >
          Manage Blocks
        </button>
      </div>
    </div>
  )
}

// ========================================
// Collapsible Section
// ========================================

function CollapsibleSection({
  children,
  defaultOpen = false,
  title,
}: {
  children: React.ReactNode
  defaultOpen?: boolean
  title: string
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div>
      <button
        className="flex w-full items-center justify-between text-xs font-semibold text-gray-400 uppercase tracking-wide hover:text-gray-300"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        {title}
        <span>{isOpen ? '▼' : '▶'}</span>
      </button>
      {isOpen && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  )
}

// ========================================
// Timeline Type Selector
// ========================================

const TIMELINE_TYPE_OPTIONS: {
  label: string
  value: StatusTimelineType
}[] = [
  { label: '🏠 Home', value: 'home' },
  { label: '👥 Local', value: 'local' },
  { label: '🌐 Public', value: 'public' },
]

function TimelineTypeSelector({
  configType,
  onChange,
  value,
}: {
  configType: TimelineConfigV2['type']
  onChange: (types: StatusTimelineType[] | undefined) => void
  value: StatusTimelineType[] | undefined
}) {
  // 未設定時は config.type から推定
  const defaultTypes: StatusTimelineType[] =
    configType === 'home' || configType === 'local' || configType === 'public'
      ? [configType]
      : []
  const selected: StatusTimelineType[] = value ?? defaultTypes

  const toggle = (v: StatusTimelineType) => {
    const next = selected.includes(v)
      ? selected.filter((s) => s !== v)
      : [...selected, v]

    // 空配列 → undefined（タイムラインなし）
    if (next.length === 0) {
      onChange(undefined)
    } else {
      onChange(next)
    }
  }

  return (
    <div className="space-y-1">
      <span className="text-xs text-gray-400">Timeline Sources</span>
      <div className="flex flex-wrap gap-2">
        {TIMELINE_TYPE_OPTIONS.map((opt) => (
          <label
            className="flex items-center gap-1 text-xs cursor-pointer"
            key={opt.value}
          >
            <input
              checked={selected.includes(opt.value)}
              className="cursor-pointer"
              onChange={() => toggle(opt.value)}
              type="checkbox"
            />
            {opt.label}
          </label>
        ))}
      </div>
    </div>
  )
}

// ========================================
// FilterControls（統合コンポーネント）
// ========================================

export function FilterControls({ config, onChange }: FilterControlsProps) {
  return (
    <div className="space-y-3">
      <CollapsibleSection defaultOpen title="Sources">
        <TimelineTypeSelector
          configType={config.type}
          onChange={(timelineTypes) => onChange({ timelineTypes })}
          value={config.timelineTypes}
        />
        <NotificationTypeFilter
          onChange={(notificationFilter) => onChange({ notificationFilter })}
          value={config.notificationFilter}
        />
      </CollapsibleSection>

      <CollapsibleSection defaultOpen={false} title="Media">
        <MediaFilterControls config={config} onChange={onChange} />
      </CollapsibleSection>

      <CollapsibleSection defaultOpen={false} title="Filters">
        <VisibilityFilter
          onChange={(visibilityFilter) => onChange({ visibilityFilter })}
          value={config.visibilityFilter}
        />

        <LanguageFilter
          onChange={(languageFilter) => onChange({ languageFilter })}
          value={config.languageFilter}
        />

        <ToggleFilters config={config} onChange={onChange} />

        <AccountFilterEditor
          onChange={(accountFilter) => onChange({ accountFilter })}
          value={config.accountFilter}
        />
      </CollapsibleSection>
    </div>
  )
}

export { MuteBlockControls }
