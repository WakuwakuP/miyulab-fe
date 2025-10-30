'use client'

import type { ReactNode } from 'react'

import { createPortal } from 'react-dom'

export const Modal = ({
  children,
  onClick,
}: {
  children: ReactNode
  onClick: () => void
}) => {
  return createPortal(
    <div
      className="fixed inset-0 z-40 h-screen w-screen bg-black/60"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      role="button"
      tabIndex={0}
    >
      {children}
    </div>,
    document.body,
  )
}
