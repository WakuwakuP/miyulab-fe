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
    queryDuration == null ? undefined : `Query: ${queryDuration.toFixed(2)} ms`

  return (
    <section>
      {typeof name === 'string' ? (
        <h2 className="h-8 bg-slate-800 text-center" title={durationTitle}>
          {onClickHeader == null ? (
            <span className="block p-1">{name}</span>
          ) : (
            <button
              className="h-full w-full cursor-pointer border-0 bg-transparent p-1 text-center text-inherit"
              onClick={onClickHeader}
              type="button"
            >
              {name}
            </button>
          )}
        </h2>
      ) : null}
      <div className={className} ref={ref} style={{ height: mainAreaHeight }}>
        {children}
      </div>
    </section>
  )
}
