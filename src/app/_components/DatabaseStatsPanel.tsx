'use client'

import { QueueStatsGraph } from 'app/_components/QueueStatsGraph'
import { useCallback, useEffect, useState } from 'react'
import { getSqliteDb } from 'util/db/sqlite/connection'

type TableCount = {
  name: string
  count: number
}

const TABLE_NAMES = [
  'posts',
  'timeline_entries',
  'post_hashtags',
  'post_mentions',
  'post_backend_ids',
  'notifications',
  'muted_accounts',
  'blocked_instances',
] as const

/**
 * json カラムを含む大きなテーブルでは COUNT(*) がフルテーブルスキャンとなり遅い。
 * INDEXED BY ヒントで小さいインデックスをスキャンさせることで高速化する。
 */
const INDEX_HINTS: Partial<Record<(typeof TABLE_NAMES)[number], string>> = {
  notifications: ' INDEXED BY idx_notifications_account_created',
  posts: ' INDEXED BY idx_posts_created',
}

export const DatabaseStatsPanel = () => {
  const [tableCounts, setTableCounts] = useState<TableCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchCounts = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const handle = await getSqliteDb()

      // Single query using UNION ALL for all table counts
      const sql = TABLE_NAMES.map(
        (name) =>
          `SELECT '${name}' AS name, COUNT(*) AS cnt FROM ${name}${INDEX_HINTS[name] ?? ''}`,
      ).join(' UNION ALL ')

      const rows = (await handle.execAsync(sql, {
        kind: 'other',
        returnValue: 'resultRows',
      })) as [string, number][]

      setTableCounts(rows.map(([name, count]) => ({ count, name })))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCounts()
  }, [fetchCounts])

  return (
    <div className="p-2 pt-4">
      <div className="flex items-center justify-between pb-2">
        <h3 className="text-lg font-bold">Database Stats</h3>
        <button
          className="rounded-md border px-3 py-1 text-sm hover:bg-slate-800"
          onClick={fetchCounts}
          type="button"
        >
          Refresh
        </button>
      </div>
      {loading && <p className="text-gray-400">Loading...</p>}
      {error && <p className="text-red-400">{error}</p>}
      {!loading && !error && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-600">
              <th className="py-1 text-left">Table</th>
              <th className="py-1 text-right">Rows</th>
            </tr>
          </thead>
          <tbody>
            {tableCounts.map((tc) => (
              <tr className="border-b border-gray-700" key={tc.name}>
                <td className="py-1">{tc.name}</td>
                <td className="py-1 text-right">{tc.count.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <QueueStatsGraph />
    </div>
  )
}
