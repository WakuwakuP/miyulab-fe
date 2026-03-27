import { localAccountCache } from './cache'
import type { DbExecCompat } from './types'

/**
 * posts_backends から post_id を解決する
 *
 * backendUrl + localId から post_id を逆引きする。
 * 見つからない場合は null を返す。
 */
export function resolvePostId(
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
  localId: string,
): number | null {
  const rows = db.exec(
    `SELECT post_id FROM posts_backends
     WHERE server_id = (SELECT server_id FROM servers WHERE base_url = ?)
       AND local_id = ?;`,
    { bind: [backendUrl, localId], returnValue: 'resultRows' },
  ) as number[][]
  return rows.length > 0 ? rows[0][0] : null
}

export function resolveLocalAccountId(
  db: DbExecCompat,
  backendUrl: string,
): number | null {
  const cached = localAccountCache.get(backendUrl)
  if (cached !== undefined) return cached

  const rows = db.exec(
    `SELECT la.local_account_id
     FROM local_accounts la
     INNER JOIN servers sv ON la.server_id = sv.server_id
     WHERE sv.base_url = ?
     LIMIT 1;`,
    { bind: [backendUrl], returnValue: 'resultRows' },
  ) as number[][]
  const result = rows.length > 0 ? rows[0][0] : null
  localAccountCache.set(backendUrl, result)
  return result
}
