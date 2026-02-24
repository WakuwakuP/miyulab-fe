'use client'

import { cn } from 'components/lib/utils'
import { EmojiStyle, Theme } from 'emoji-picker-react'
import type { Entity } from 'megalodon'
import dynamic from 'next/dynamic'
import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { RiAddLine, RiCloseLine } from 'react-icons/ri'
import { EmojiContext } from 'util/provider/ResourceProvider'
import {
  SetSettingContext,
  SettingContext,
} from 'util/provider/SettingProvider'
import { TimelineManagement } from './TimelineManagement'

const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false })

const SettingItem = ({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) => <div className={cn('flex items-center py-1 ', className)}>{children}</div>

const SettingCheckbox = ({
  id,
  label,
  checked,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
}) => (
  <SettingItem>
    <input
      checked={checked}
      className="mr-1 cursor-pointer"
      id={id}
      onChange={onChange}
      type="checkbox"
    />
    <label className="cursor-pointer" htmlFor={id}>
      {label}
    </label>
  </SettingItem>
)

const SettingNumberInput = ({
  id,
  label,
  value,
  step = undefined,
  onChange,
}: {
  id: string
  label: string
  value: number
  step?: number
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
}) => (
  <SettingItem>
    <label className="mr-1" htmlFor={id}>
      {label}
    </label>
    <input
      className="w-24"
      id={id}
      onChange={onChange}
      step={step}
      type="number"
      value={value}
    />
  </SettingItem>
)
const SettingSelect = ({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: {
    value: string
    name: string
  }[]
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void
}) => (
  <SettingItem className="justify-between">
    <label className="mr-1" htmlFor={id}>
      {label}
    </label>
    <select className="w-32" id={id} onChange={onChange} value={value}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.name}
        </option>
      ))}
    </select>
  </SettingItem>
)

const ReactionEmojisSetting = () => {
  const setting = useContext(SettingContext)
  const setSetting = useContext(SetSettingContext)
  const emojis = useContext(EmojiContext)
  const [showPicker, setShowPicker] = useState(false)

  const emojiUrlMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of emojis) {
      map.set(e.shortcode, e.url)
    }
    return map
  }, [emojis])

  const customEmojis = useMemo(
    () =>
      emojis
        .filter((e) => e.url !== '')
        .map((e) => ({
          id: e.shortcode,
          imgUrl: e.url,
          names: [e.shortcode],
        })),
    [emojis],
  )

  const handleAdd = useCallback(
    (emojiData: { isCustom: boolean; emoji: string }) => {
      const emoji = emojiData.isCustom
        ? `:${emojiData.emoji}:`
        : emojiData.emoji
      if (!setting.reactionEmojis.includes(emoji)) {
        setSetting({
          ...setting,
          reactionEmojis: [...setting.reactionEmojis, emoji],
        })
      }
      setShowPicker(false)
    },
    [setting, setSetting],
  )

  const handleRemove = useCallback(
    (emoji: string) => {
      setSetting({
        ...setting,
        reactionEmojis: setting.reactionEmojis.filter((e) => e !== emoji),
      })
    },
    [setting, setSetting],
  )

  return (
    <SettingItem className="flex-col items-start gap-1">
      <span>Reaction emojis</span>
      <div className="flex flex-wrap items-center gap-1">
        {setting.reactionEmojis.map((emoji) => {
          const isCustom =
            emoji.startsWith(':') && emoji.endsWith(':') && emoji.length > 2
          const shortcode = isCustom ? emoji.slice(1, -1) : null
          const url = shortcode ? emojiUrlMap.get(shortcode) : null
          return (
            <div
              className="flex items-center gap-0.5 rounded bg-gray-700 px-1 py-0.5"
              key={emoji}
            >
              <span className="text-lg">
                {isCustom && url ? (
                  <img
                    alt={shortcode ?? ''}
                    className="inline-block h-5 w-5"
                    src={url}
                  />
                ) : (
                  emoji
                )}
              </span>
              <button
                className="text-gray-400 hover:text-white"
                onClick={() => handleRemove(emoji)}
                type="button"
              >
                <RiCloseLine size={14} />
              </button>
            </div>
          )
        })}
        <button
          className="flex items-center justify-center rounded bg-gray-700 p-1 text-gray-400 hover:bg-gray-600 hover:text-white"
          onClick={() => setShowPicker(true)}
          type="button"
        >
          <RiAddLine size={20} />
        </button>
      </div>
      {showPicker &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-50"
              onClick={() => setShowPicker(false)}
            />
            <div
              className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2"
              onClick={(e) => e.stopPropagation()}
            >
              <EmojiPicker
                customEmojis={customEmojis}
                emojiStyle={EmojiStyle.NATIVE}
                height={400}
                lazyLoadEmojis
                onEmojiClick={handleAdd}
                searchPlaceholder="Search emoji..."
                skinTonesDisabled
                theme={Theme.DARK}
                width={350}
              />
            </div>
          </>,
          document.body,
        )}
    </SettingItem>
  )
}

export const SettingPanel = () => {
  const setting = useContext(SettingContext)
  const setSetting = useContext(SetSettingContext)
  const [showTimelineManagement, setShowTimelineManagement] = useState(false)

  return (
    <div className="p-2 pt-4">
      <SettingItem>
        <button
          className="w-full text-left py-2 px-3 bg-gray-700 hover:bg-gray-600 rounded-md text-white"
          onClick={() => setShowTimelineManagement(!showTimelineManagement)}
          type="button"
        >
          Timeline Management
        </button>
      </SettingItem>

      {showTimelineManagement && (
        <div className="mt-4 border border-gray-600 rounded-md">
          <TimelineManagement />
        </div>
      )}

      <SettingCheckbox
        checked={setting.showSensitive}
        id="showSensitive"
        label="Default Show sensitive content"
        onChange={(e) =>
          setSetting({
            ...setting,
            showSensitive: e.target.checked,
          })
        }
      />
      <SettingSelect
        id="playerSize"
        label="Player size"
        onChange={(e) => {
          if (['small', 'medium', 'large'].includes(e.target.value)) {
            setSetting({
              ...setting,
              playerSize: e.target.value as 'small' | 'medium' | 'large',
            })
          }
        }}
        options={[
          { name: 'Small', value: 'small' },
          { name: 'Medium', value: 'medium' },
          { name: 'Large', value: 'large' },
        ]}
        value={setting.playerSize}
      />
      <SettingSelect
        id="defaultStatusVisibility"
        label="Default visibility"
        onChange={(e) => {
          if (
            ['public', 'unlisted', 'private', 'direct'].includes(e.target.value)
          ) {
            setSetting({
              ...setting,
              defaultStatusVisibility: e.target
                .value as Entity.StatusVisibility,
            })
          }
        }}
        options={[
          { name: 'Public', value: 'public' },
          { name: 'Unlisted', value: 'unlisted' },
          { name: 'Private', value: 'private' },
          { name: 'Direct', value: 'direct' },
        ]}
        value={setting.defaultStatusVisibility}
      />
      <SettingNumberInput
        id="recentHashtagsCount"
        label="Recent hashtags count"
        onChange={(e) => {
          const value = Number.parseInt(e.target.value, 10)
          if (!Number.isNaN(value) && value >= 0 && value <= 50) {
            setSetting({
              ...setting,
              recentHashtagsCount: value,
            })
          }
        }}
        value={setting.recentHashtagsCount}
      />
      <ReactionEmojisSetting />
    </div>
  )
}
