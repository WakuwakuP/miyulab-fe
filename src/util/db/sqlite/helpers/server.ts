import { serverIdCache } from './cache'
import type { DbExecCompat } from './types'

/**
 * host に対応する servers.id を返す。
 * 未登録の場合は servers テーブルに INSERT してから返す。
 */
export function ensureServer(db: DbExecCompat, host: string): number {
  const cached = serverIdCache.get(host)
  if (cached !== undefined) return cached

  db.exec('INSERT OR IGNORE INTO servers (host) VALUES (?);', {
    bind: [host],
  })

  const rows = db.exec('SELECT id FROM servers WHERE host = ?;', {
    bind: [host],
    returnValue: 'resultRows',
  }) as number[][]

  const id = rows[0][0]
  serverIdCache.set(host, id)
  return id
}
