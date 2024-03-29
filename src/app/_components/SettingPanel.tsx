import { ChangeEvent, ReactNode, useContext } from 'react'

import {
  SetSettingContext,
  SettingContext,
} from 'util/provider/SettingProvider'

const SettingItem = ({
  children,
}: {
  children: ReactNode
}) => (
  <div className="flex items-center py-1">{children}</div>
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
  <SettingItem>
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

  return (
    <div className="p-2 pt-4">
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
    </div>
  )
}
