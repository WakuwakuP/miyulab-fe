import React, { useContext } from 'react'

import {
  SetSettingContext,
  SettingContext,
} from 'util/provider/SettingProvider'

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
  <div>
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
  </div>
)

export const SettingPanel = () => {
  const setting = useContext(SettingContext)
  const setSetting = useContext(SetSettingContext)

  return (
    <div className="mt-2 p-2">
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
