import { serverCache } from './cache'

/**
 * backendUrl に対応する server_id を返す。
 * 未登録の場合は servers テーブルに INSERT してから返す。
 */
export function ensureServer(
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  },
  backendUrl: string,
): number {
  const cached = serverCache.get(backendUrl)
  if (cached !== undefined) return cached

  const host = new URL(backendUrl).host

  db.exec('INSERT OR IGNORE INTO servers (host, base_url) VALUES (?, ?);', {
    bind: [host, backendUrl],
  })

  const rows = db.exec('SELECT server_id FROM servers WHERE base_url = ?;', {
    bind: [backendUrl],
    returnValue: 'resultRows',
  }) as number[][]

  serverCache.set(backendUrl, rows[0][0])
  return rows[0][0]
}
