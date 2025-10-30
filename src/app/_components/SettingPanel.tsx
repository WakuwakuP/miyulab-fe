'use client'

import type { Entity } from 'megalodon'
import { type ChangeEvent, type ReactNode, useContext, useState } from 'react'

import {
  SetSettingContext,
  SettingContext,
} from 'util/provider/SettingProvider'

import { TimelineManagement } from './TimelineManagement'

const SettingItem = ({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) => <div className={`flex items-center py-1 ${className}`}>{children}</div>

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

// eslint-disable-next-line unused-imports/no-unused-vars, @typescript-eslint/no-unused-vars
const _SettingNumberInput = ({
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

export const SettingPanel = () => {
  const setting = useContext(SettingContext)
  const setSetting = useContext(SetSettingContext)
  const [showTimelineManagement, setShowTimelineManagement] = useState(false)

  return (
    <div className="p-2 pt-4">
      <SettingItem>
        <button
          type="button"
          className="w-full text-left py-2 px-3 bg-gray-700 hover:bg-gray-600 rounded-md text-white"
          onClick={() => setShowTimelineManagement(!showTimelineManagement)}
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
    </div>
  )
}
