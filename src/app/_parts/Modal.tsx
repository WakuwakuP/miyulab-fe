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
    <div className="fixed inset-0 z-40 h-screen w-screen">
      <button
        aria-label="Close"
        className="absolute inset-0 h-full w-full bg-black/60"
        onClick={onClick}
        type="button"
      />
      {children}
    </div>,
    document.body,
  )
}
