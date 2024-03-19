import React, { ReactNode, useContext } from 'react'

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
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
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
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
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
    </div>
  )
}
