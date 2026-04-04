'use client'

import type { DebugResultItem } from './types'

type Props = {
  results: DebugResultItem[]
}

export function DebugResultPanel({ results }: Props) {
  if (results.length === 0) {
    return <div className="text-[10px] text-gray-500 py-1">結果なし</div>
  }

  const postCount = results.filter((r) => r.table === 'posts').length
  const notifCount = results.filter((r) => r.table === 'notifications').length

  return (
    <div>
      <div className="text-[10px] text-gray-500 mb-1">
        結果: {results.length} 件
        {postCount > 0 && (
          <span className="ml-1 text-blue-400">📝{postCount}</span>
        )}
        {notifCount > 0 && (
          <span className="ml-1 text-amber-400">🔔{notifCount}</span>
        )}
      </div>
      <div className="max-h-40 overflow-y-auto space-y-0.5">
        {results.map((item) =>
          item.table === 'posts' ? (
            <PostRow item={item} key={`p-${item.id}`} />
          ) : (
            <NotificationRow item={item} key={`n-${item.id}`} />
          ),
        )}
      </div>
    </div>
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
