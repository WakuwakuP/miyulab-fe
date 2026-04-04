'use client'

import { useState } from 'react'

export function CollapsibleSection({
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
