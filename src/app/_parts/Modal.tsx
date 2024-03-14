'use client'

import { ReactNode } from 'react'

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
    >
      {children}
    </div>,
    document.body
  )
}
