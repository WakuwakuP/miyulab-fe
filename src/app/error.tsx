'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <div className="rounded-md border bg-gray-600 p-12 text-center">
        <h2 className="pb-4 text-2xl">エラーが発生しました</h2>
        <button
          className="rounded-md border bg-gray-900 px-4 py-2"
          onClick={reset}
          type="button"
        >
          再試行
        </button>
      </div>
    </div>
  )
}
