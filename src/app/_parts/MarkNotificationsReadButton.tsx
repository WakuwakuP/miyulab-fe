'use client'

import { CheckCheck, LoaderCircle } from 'lucide-react'
import { useContext } from 'react'
import { NotificationReadContext } from 'util/provider/NotificationReadProvider'

export function MarkNotificationsReadButton() {
  const { isRunning, available, markAllRead } = useContext(
    NotificationReadContext,
  )
  const label = isRunning
    ? '既読にしています…'
    : '全アカウントの通知をすべて既読にする'
  return (
    <button
      aria-busy={isRunning}
      aria-label={label}
      className="mr-6 inline-flex h-full min-w-[24px] shrink-0 items-center justify-center px-1 disabled:opacity-40 [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:min-w-[44px]"
      disabled={isRunning || !available}
      onClick={markAllRead}
      title={label}
      type="button"
    >
      {isRunning ? (
        <LoaderCircle aria-hidden="true" className="animate-spin" size={18} />
      ) : (
        <CheckCheck aria-hidden="true" size={18} />
      )}
      <span aria-live="polite" className="sr-only">
        {isRunning ? label : ''}
      </span>
    </button>
  )
}
