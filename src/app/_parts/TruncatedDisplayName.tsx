'use client'

import parse from 'html-react-parser'
import type { ReactNode } from 'react'

/**
 * Truncate mixed text + custom-emoji images inside a flex row.
 *
 * `truncate` on the flex item itself is unreliable when children include
 * replaced elements (`img`). Width is forced by `w-0 flex-1 min-w-0`, and
 * ellipsis is applied on an inner block box.
 */
const EMOJI_TRUNCATE_CLASS =
  '[&_img]:inline-block [&_img]:h-4 [&_img]:max-h-4 [&_img]:w-4 [&_img]:max-w-4'

export function TruncatedDisplayName({
  children,
  className = '',
  flexItem = true,
  html,
  title,
}: {
  children?: ReactNode
  className?: string
  /** false when this sits in a block column, not a flex row */
  flexItem?: boolean
  html?: string
  title?: string
}) {
  const content = html == null ? children : parse(html)

  if (!flexItem) {
    return (
      <span
        className={['block min-w-0 truncate', EMOJI_TRUNCATE_CLASS, className]
          .filter(Boolean)
          .join(' ')}
        title={title}
      >
        {content}
      </span>
    )
  }

  return (
    <span
      className={['min-w-0 w-0 flex-1 overflow-hidden', className]
        .filter(Boolean)
        .join(' ')}
      title={title}
    >
      <span className={`block truncate ${EMOJI_TRUNCATE_CLASS}`}>
        {content}
      </span>
    </span>
  )
}
