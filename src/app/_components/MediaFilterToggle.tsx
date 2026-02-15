'use client'

type MediaFilterToggleProps = {
  onChange: (value: boolean) => void
  value: boolean
}

export const MediaFilterToggle = ({
  onChange,
  value,
}: MediaFilterToggleProps) => {
  return (
    <div className="space-y-1">
      <span className="text-xs font-semibold text-gray-300">Media Filter</span>
      <label className="flex items-center space-x-2 cursor-pointer text-sm">
        <input
          checked={value}
          className="cursor-pointer"
          onChange={(e) => onChange(e.target.checked)}
          type="checkbox"
        />
        <span>📷 Show only media posts</span>
      </label>
    </div>
  )
}
