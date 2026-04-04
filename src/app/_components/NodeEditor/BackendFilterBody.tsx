'use client'

import { Checkbox } from 'components/ui/checkbox'
import { useCallback } from 'react'
import type { ResolvedAccount } from 'util/accountResolver'
import type { BackendFilter as IRBackendFilter } from 'util/db/query-ir/nodes'

export function BackendFilterBody({
  accounts,
  node,
  onUpdate,
}: {
  accounts?: ReadonlyMap<string, ResolvedAccount>
  node: IRBackendFilter
  onUpdate: (n: IRBackendFilter) => void
}) {
  const accountEntries = accounts ? [...accounts.entries()] : []

  const toggleAccount = useCallback(
    (localAccountId: number) => {
      const ids = new Set(node.localAccountIds)
      if (ids.has(localAccountId)) {
        ids.delete(localAccountId)
      } else {
        ids.add(localAccountId)
      }
      onUpdate({ ...node, localAccountIds: [...ids] })
    },
    [node, onUpdate],
  )

  if (accountEntries.length === 0) {
    return (
      <div className="text-xs text-gray-400">
        アカウント ID: {node.localAccountIds.join(', ') || '(なし)'}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {accountEntries.map(([url, resolved]) => (
        <span
          className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer"
          key={url}
          onClick={() => toggleAccount(resolved.localAccountId)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ')
              toggleAccount(resolved.localAccountId)
          }}
        >
          <Checkbox
            checked={node.localAccountIds.includes(resolved.localAccountId)}
            onCheckedChange={() => toggleAccount(resolved.localAccountId)}
          />
          <span className="truncate" title={url}>
            {new URL(url).hostname}
          </span>
        </span>
      ))}
    </div>
  )
}
