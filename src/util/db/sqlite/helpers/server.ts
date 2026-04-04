import { serverHostCache, serverIdCache } from './cache'
import type { DbExecCompat } from './types'

/**
 * host に対応する servers.id を返す。
 * 未登録の場合は servers テーブルに INSERT してから返す。
 */
export function ensureServer(db: DbExecCompat, host: string): number {
  // 常に INSERT OR IGNORE を実行して行の存在を保証する。
  // キャッシュだけに頼ると、前回のトランザクションが ROLLBACK された場合に
  // 行が存在しないのにキャッシュにIDが残る（キャッシュ不整合）ため、
  // FK 制約違反が連鎖的に発生する。
  db.exec('INSERT OR IGNORE INTO servers (host) VALUES (?);', {
    bind: [host],
  })

  const cached = serverIdCache.get(host)
  if (cached !== undefined) return cached

  const rows = db.exec('SELECT id FROM servers WHERE host = ?;', {
    bind: [host],
    returnValue: 'resultRows',
  }) as number[][]

  const id = rows[0][0]
  serverIdCache.set(host, id)
  serverHostCache.set(id, host)
  return id
}
