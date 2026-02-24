'use client'

import { type HTMLProps, type ReactNode, useRef } from 'react'

export const Panel = ({
  children,
  name,
  onClickHeader,
  className,
  queryDuration,
  headerOffset,
}: {
  children: ReactNode
  onClickHeader?: () => void
  name?: string
  className?: HTMLProps<HTMLElement>['className']
  queryDuration?: number | null
  headerOffset?: string
}) => {
  const ref = useRef<HTMLDivElement>(null)
  const offset = headerOffset ?? '0px'
  const mainAreaHeight =
    name === undefined
      ? `calc(100vh - 0.75rem - ${offset})`
      : `calc(100vh - 0.75rem - 2rem - ${offset})`

  const durationTitle =
    queryDuration != null ? `Query: ${queryDuration.toFixed(2)} ms` : undefined

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
          title={durationTitle}
        >
          {name}
        </h2>
      )}
      <div className={className} ref={ref} style={{ height: mainAreaHeight }}>
        {children}
      </div>
    </section>
  )
}
