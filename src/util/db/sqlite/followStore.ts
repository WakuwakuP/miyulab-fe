/**
 * SQLite ベースの Follow ストア
 *
 * フォロー関係の同期を Worker に委譲する。
 */

import type { Entity } from 'megalodon'
import { getSqliteDb } from './connection'

/**
 * フォロー一覧を同期する
 *
 * 指定バックエンドの全フォローを削除し、渡されたアカウント一覧で再構築する。
 */
export async function syncFollows(
  accounts: Entity.Account[],
  backendUrl: string,
): Promise<void> {
  if (accounts.length === 0) return

  const handle = await getSqliteDb()
  await handle.sendCommand({
    accountsJson: accounts.map((a) => JSON.stringify(a)),
    backendUrl,
    type: 'syncFollows',
  })
}
