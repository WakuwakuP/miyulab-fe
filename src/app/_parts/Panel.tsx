'use client'

import { HTMLProps, ReactNode, useRef } from 'react'

export const Panel = ({
  children,
  name,
  className,
}: {
  children: ReactNode
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
          className="h-[2rem] bg-slate-800 p-1 text-center"
          onClick={() => {
            ref.current?.scrollTo(0, 0)
          }}
        >
          {name}
        </h2>
      )}
      <div
        ref={ref}
        className={[
          'scroll-smooth',
          'overflow-y-scroll',
          mainAreaStyle,
          className,
        ].join(' ')}
      >
        {children}
      </div>
    </section>
  )
}
