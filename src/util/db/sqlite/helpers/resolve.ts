import { localAccountIdCache } from './cache'
import type { DbExecCompat } from './types'

export function resolvePostId(
  db: DbExecCompat,
  backendUrl: string,
  localId: string,
): number | undefined {
  // 1. backendUrl から local_account_id を取得
  const accountId = resolveLocalAccountId(db, backendUrl)
  if (accountId == null) return undefined

  // 2. post_backend_ids から post_id を取得
  const rows = db.exec(
    'SELECT post_id FROM post_backend_ids WHERE local_account_id = ? AND local_id = ?;',
    { bind: [accountId, localId], returnValue: 'resultRows' },
  ) as number[][]

  return rows.length > 0 ? rows[0][0] : undefined
}

export function resolveLocalAccountId(
  db: DbExecCompat,
  backendUrl: string,
): number | null {
  const cached = localAccountIdCache.get(backendUrl)
  if (cached !== undefined) return cached

  const rows = db.exec('SELECT id FROM local_accounts WHERE backend_url = ?;', {
    bind: [backendUrl],
    returnValue: 'resultRows',
  }) as number[][]

  const id = rows.length > 0 ? rows[0][0] : null
  localAccountIdCache.set(backendUrl, id)
  return id
}
