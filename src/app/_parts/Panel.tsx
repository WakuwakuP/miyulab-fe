'use client'

import { type HTMLProps, type ReactNode, useRef } from 'react'

export const Panel = ({
  children,
  name,
  onClickHeader,
  className,
  queryDuration,
  headerOffset,
  headerActions,
}: {
  children: ReactNode
  onClickHeader?: () => void
  name?: string
  className?: HTMLProps<HTMLElement>['className']
  queryDuration?: number | null
  headerOffset?: string
  headerActions?: ReactNode
}) => {
  const ref = useRef<HTMLDivElement>(null)
  const offset = headerOffset ?? '0px'
  const mainAreaHeight =
    name === undefined
      ? `calc(100vh - 0.75rem - ${offset})`
      : `calc(100vh - 0.75rem - var(--panel-header-height) - ${offset})`

  const durationTitle =
    queryDuration == null ? undefined : `Query: ${queryDuration.toFixed(2)} ms`

  return (
    <section
      className={`min-w-0 max-w-full overflow-x-hidden [--panel-header-height:2rem] ${headerActions ? '[@media(pointer:coarse)]:[--panel-header-height:44px]' : ''}`}
    >
      {typeof name === 'string' ? (
        <div className="flex h-[var(--panel-header-height)] bg-slate-800">
          <h2 className="min-w-0 flex-1 text-center" title={durationTitle}>
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
          {headerActions}
        </div>
      ) : null}
      <div className={className} ref={ref} style={{ height: mainAreaHeight }}>
        {children}
      </div>
    </section>
  )
}
