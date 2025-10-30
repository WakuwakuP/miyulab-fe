'use client'

import { type HTMLProps, type ReactNode, useRef } from 'react'

export const Panel = ({
  children,
  name,
  onClickHeader,
  className,
}: {
  children: ReactNode
  onClickHeader?: () => void
  name?: string
  className?: HTMLProps<HTMLElement>['className']
}) => {
  const ref = useRef<HTMLDivElement>(null)
  const mainAreaStyle =
    name === undefined
      ? 'h-[calc(100vh-0.75rem)]'
      : 'h-[calc(100vh-0.75rem-2rem)]'
  return (
    <section>
      {name === undefined ? null : (
        <h2
          className="h-8 bg-slate-800 p-1 text-center"
          onClick={() => {
            if (onClickHeader != null) {
              onClickHeader()
            }
          }}
        >
          {name}
        </h2>
      )}
      <div className={[mainAreaStyle, className].join(' ')} ref={ref}>
        {children}
      </div>
    </section>
  )
}
