'use client'

import { CgSpinner } from 'react-icons/cg'

/**
 * タイムラインのローディング表示。
 * データが空かつ初期化中に各タイムラインパネル内に表示する。
 */
export const TimelineLoading = () => {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-2 text-gray-400">
        <CgSpinner className="animate-spin" size={32} />
        <span className="text-sm">読み込み中…</span>
      </div>
    </div>
  )
}
