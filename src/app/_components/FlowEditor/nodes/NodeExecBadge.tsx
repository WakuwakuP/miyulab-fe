'use client'

import { Loader2 } from 'lucide-react'
import { memo } from 'react'
import type { FlowExecStatus } from '../types'

type Props = {
  nodeId: string
  execStatus: FlowExecStatus | null
}

/**
 * ノードの実行状態バッジ。
 * 実行中はスピナー、完了後は件数・時間・キャッシュヒットを表示する。
 */
export const NodeExecBadge = memo(function NodeExecBadge({
  nodeId,
  execStatus,
}: Props) {
  if (!execStatus) return null

  const state = execStatus.nodeStates[nodeId]
  const stat = execStatus.nodeStats[nodeId]

  if (state === 'running') {
    return (
      <div className="flex items-center gap-1 mt-1.5 text-[10px] text-amber-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>実行中…</span>
      </div>
    )
  }

  if (state === 'error') {
    return <div className="mt-1.5 text-[10px] text-red-400">❌ エラー</div>
  }

  if (state === 'done' && stat) {
    return (
      <div className="flex items-center gap-2 mt-1.5">
        <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded-full">
          {stat.rowCount.toLocaleString()} 件
        </span>
        <span className="text-[10px] text-gray-500">
          {stat.durationMs.toFixed(0)}ms
        </span>
        {stat.cacheHit && (
          <span
            className="text-[10px] text-yellow-500"
            title="キャッシュヒット"
          >
            💾
          </span>
        )}
      </div>
    )
  }

  return null
})
