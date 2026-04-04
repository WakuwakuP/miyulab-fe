'use client'

import type { RawSQLFilter } from 'util/db/query-ir/nodes'

export function RawSQLBody({
  node,
  onUpdate,
}: {
  node: RawSQLFilter
  onUpdate: (n: RawSQLFilter) => void
}) {
  return (
    <textarea
      className="w-full rounded bg-gray-800 border border-gray-600 px-2 py-1 text-xs text-gray-200 font-mono resize-y min-h-[2.5rem]"
      onChange={(e) => onUpdate({ ...node, where: e.target.value })}
      placeholder="SQL 条件式"
      value={node.where}
    />
  )
}
