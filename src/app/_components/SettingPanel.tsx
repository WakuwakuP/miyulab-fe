'use client'

import {
  type ChangeEvent,
  type ReactNode,
  useContext,
  useState,
} from 'react'

import { type Entity } from 'megalodon'

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
}) => (
  <div className={'flex items-center py-1 ' + className}>
    {children}
  </div>
)

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
      id={id}
      className="mr-1 cursor-pointer"
      type="checkbox"
      checked={checked}
      onChange={onChange}
    />
    <label
      htmlFor={id}
      className="cursor-pointer"
    >
      {label}
    </label>
  </SettingItem>
)

// eslint-disable-next-line unused-imports/no-unused-vars, @typescript-eslint/no-unused-vars
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
    <label
      htmlFor={id}
      className="mr-1"
    >
      {label}
    </label>
    <input
      id={id}
      className="w-24"
      type="number"
      step={step}
      value={value}
      onChange={onChange}
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
    <label
      htmlFor={id}
      className="mr-1"
    >
      {label}
    </label>
    <select
      id={id}
      className="w-32"
      value={value}
      onChange={onChange}
    >
      {options.map((option) => (
        <option
          key={option.value}
          value={option.value}
        >
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
          onClick={() => setShowTimelineManagement(!showTimelineManagement)}
          className="w-full text-left py-2 px-3 bg-gray-700 hover:bg-gray-600 rounded-md text-white"
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
        id="showSensitive"
        label="Default Show sensitive content"
        checked={setting.showSensitive}
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
        value={setting.playerSize}
        onChange={(e) => {
          if (
            ['small', 'medium', 'large'].includes(
              e.target.value
            )
          ) {
            setSetting({
              ...setting,
              playerSize: e.target.value as
                | 'small'
                | 'medium'
                | 'large',
            })
          }
        }}
        options={[
          { value: 'small', name: 'Small' },
          { value: 'medium', name: 'Medium' },
          { value: 'large', name: 'Large' },
        ]}
      />
      <SettingSelect
        id="defaultStatusVisibility"
        label="Default visibility"
        value={setting.defaultStatusVisibility}
        onChange={(e) => {
          if (
            [
              'public',
              'unlisted',
              'private',
              'direct',
            ].includes(e.target.value)
          ) {
            setSetting({
              ...setting,
              defaultStatusVisibility: e.target
                .value as Entity.StatusVisibility,
            })
          }
        }}
        options={[
          { value: 'public', name: 'Public' },
          { value: 'unlisted', name: 'Unlisted' },
          { value: 'private', name: 'Private' },
          { value: 'direct', name: 'Direct' },
        ]}
      />
    </div>
  )
}
