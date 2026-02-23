'use client'

import { useCallback, useEffect, useState } from 'react'
import { getSqliteDb } from 'util/db/sqlite/connection'

type TableCount = {
  name: string
  count: number
}

const TABLE_NAMES = [
  'statuses',
  'statuses_timeline_types',
  'statuses_belonging_tags',
  'statuses_mentions',
  'statuses_backends',
  'notifications',
  'muted_accounts',
  'blocked_instances',
] as const

export const DatabaseStatsPanel = () => {
  const [tableCounts, setTableCounts] = useState<TableCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchCounts = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const handle = await getSqliteDb()
      const counts: TableCount[] = []

      for (const name of TABLE_NAMES) {
        const rows = (await handle.execAsync(`SELECT COUNT(*) FROM ${name};`, {
          returnValue: 'resultRows',
        })) as number[][]
        counts.push({ count: rows[0]?.[0] ?? 0, name })
      }

      setTableCounts(counts)
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
    </div>
  )
}
