import { fn } from 'storybook/test'
import type { DbHandle, ExecOpts } from '../../src/util/db/sqlite/types'

export { isTableName } from '../../src/util/db/sqlite/protocol'

let muted = [['quiet@example.social', 1783328400000]]
let blocked = [['blocked.example', 1783328400000]]
export function resetDatabase() {
  muted = [['quiet@example.social', 1783328400000]]
  blocked = [['blocked.example', 1783328400000]]
}
const execAsync = fn(async (sql: string, opts?: ExecOpts) => {
  if (sql.includes('UNION ALL') && sql.includes('COUNT(*)'))
    return [
      ['posts', 12480],
      ['timeline_entries', 18240],
      ['post_hashtags', 820],
      ['post_mentions', 412],
      ['post_backend_ids', 12480],
      ['notifications', 320],
      ['muted_accounts', muted.length],
      ['blocked_instances', blocked.length],
    ]
  const table = sql.includes('muted_accounts')
    ? muted
    : sql.includes('blocked_instances')
      ? blocked
      : null
  if (table) {
    if (/^SELECT/.test(sql.trim())) return table
    if (/^INSERT/.test(sql.trim()))
      table.push([String(opts?.bind?.[table === muted ? 1 : 0]), 1783328400000])
    if (/^DELETE/.test(sql.trim())) {
      const index = table.findIndex(
        (row) => row[0] === opts?.bind?.[table === muted ? 1 : 0],
      )
      if (index >= 0) table.splice(index, 1)
    }
    return []
  }
  if (/^SELECT/i.test(sql.trim())) return []
  throw new Error('Storybook does not execute database writes')
})
const unsupported = async (): Promise<never> => {
  throw new Error('This database operation has no Storybook fixture')
}
const handle: DbHandle = {
  cancelStaleRequests: () => 0,
  execAsync,
  execAsyncTimed: async (sql, opts) => ({
    durationMs: 1,
    result: await execAsync(sql, opts),
  }),
  execBatch: fn(async () => ({})),
  executeFlatFetch: unsupported,
  executeGraphPlan: fn(async (plan) => ({
    capturedVersions: {},
    displayOrder: [],
    meta: {
      nodeStats: Object.fromEntries(
        plan.nodes.map((node) => [
          node.id,
          { cacheHit: false, durationMs: 1, rowCount: 0 },
        ]),
      ),
      sourceType: 'post' as const,
      totalDurationMs: 3,
    },
    nodeOutputIds: Object.fromEntries(plan.nodes.map((node) => [node.id, []])),
    notifications: { detailRows: [] },
    posts: { batchResults: {}, detailRows: [] },
  })),
  executeQueryPlan: unsupported,
  fetchTimeline: unsupported,
  persistence: 'memory',
  sendCommand: fn(async () => undefined),
}
export const getSqliteDb = async () => handle
export const getDb = getSqliteDb
export const notifyChange = fn()
export const subscribe = () => () => {}
