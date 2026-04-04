'use client'

import type { DebugNodeResult, DebugResultItem } from './types'

type Props = {
  nodeResults: DebugNodeResult[]
}

export function DebugResultPanel({ nodeResults }: Props) {
  if (nodeResults.length === 0) {
    return <div className="text-[10px] text-gray-500 py-1">結果なし</div>
  }

  return (
    <div className="space-y-2 max-h-48 overflow-y-auto">
      {nodeResults.map((nodeResult) => (
        <NodeSection key={nodeResult.nodeId} nodeResult={nodeResult} />
      ))}
    </div>
  )
}

function NodeSection({ nodeResult }: { nodeResult: DebugNodeResult }) {
  const { items, nodeLabel } = nodeResult
  const postCount = items.filter((r) => r.table === 'posts').length
  const notifCount = items.filter((r) => r.table === 'notifications').length

  return (
    <details open>
      <summary className="text-[10px] text-gray-400 cursor-pointer hover:text-gray-300 transition-colors font-mono">
        <span className="text-cyan-400">{nodeLabel}</span>
        <span className="ml-1 text-gray-500">({items.length} 件</span>
        {postCount > 0 && (
          <span className="ml-1 text-blue-400">📝{postCount}</span>
        )}
        {notifCount > 0 && (
          <span className="ml-1 text-amber-400">🔔{notifCount}</span>
        )}
        <span className="text-gray-500">)</span>
      </summary>
      <div className="ml-2 mt-0.5 space-y-0.5">
        {items.map((item) =>
          item.table === 'posts' ? (
            <PostRow item={item} key={`p-${item.id}`} />
          ) : (
            <NotificationRow item={item} key={`n-${item.id}`} />
          ),
        )}
      </div>
    </details>
  )
}

function PostRow({
  item,
}: {
  item: Extract<DebugResultItem, { table: 'posts' }>
}) {
  return (
    <div className="text-[10px] font-mono text-gray-300 flex items-start gap-1 leading-tight">
      <span className="shrink-0">{item.isReblog ? '🔁' : '📝'}</span>
      <span className="text-blue-300 shrink-0 min-w-[80px] truncate">
        {item.acct}
      </span>
      <span className="text-gray-400 flex-1 truncate">
        {item.contentPreview || '(内容なし)'}
      </span>
      <span className="text-gray-600 shrink-0 ml-1">{item.createdAt}</span>
    </div>
  )
}

function NotificationRow({
  item,
}: {
  item: Extract<DebugResultItem, { table: 'notifications' }>
}) {
  return (
    <div className="text-[10px] font-mono text-gray-300 flex items-start gap-1 leading-tight">
      <span className="shrink-0">🔔</span>
      <span className="text-amber-300 shrink-0 min-w-[60px]">
        {item.notificationType}
      </span>
      <span className="text-blue-300 shrink-0 min-w-[80px] truncate">
        {item.actorAcct}
      </span>
      <span className="text-gray-400 flex-1 truncate">
        {item.relatedContentPreview || ''}
      </span>
      <span className="text-gray-600 shrink-0 ml-1">{item.createdAt}</span>
    </div>
  )
}
