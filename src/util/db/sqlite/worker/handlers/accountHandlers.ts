/**
 * アカウント関連のハンドラ群
 *
 * 新スキーマ対応版:
 * - handleSyncFollows 削除（follows テーブル廃止）
 * - ensureProfileAlias 削除
 * - ensureServer の引数を host に変更（backendUrl からホスト名を抽出）
 * - local_accounts の SQL を新スキーマに更新
 */

import type { Entity } from 'megalodon'
import {
  ensureCustomEmoji,
  ensureProfile,
  ensureServer,
  syncProfileCustomEmojis,
} from '../../helpers'
import type { DbExec, HandlerResult } from './types'

/**
 * backendUrl からホスト名を抽出する。
 * 例: "https://mastodon.social" → "mastodon.social"
 */
function extractHost(backendUrl: string): string {
  try {
    return new URL(backendUrl).host
  } catch {
    return backendUrl
  }
}

// ================================================================
// ローカルアカウント登録
// ================================================================

export function handleEnsureLocalAccount(
  db: DbExec,
  backendUrl: string,
  accountJson: string,
): HandlerResult {
  const account = JSON.parse(accountJson) as Entity.Account
  const host = extractHost(backendUrl)
  const serverId = ensureServer(db, host)
  const profileId = ensureProfile(db, account, serverId)
  if (account.emojis.length > 0) {
    syncProfileCustomEmojis(db, profileId, serverId, account.emojis)
  }
  const now = Date.now()
  db.exec(
    `INSERT INTO local_accounts (
       server_id, backend_url, backend_type, acct, remote_account_id,
       profile_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(server_id, remote_account_id) DO UPDATE SET
       backend_url = excluded.backend_url,
       backend_type = excluded.backend_type,
       acct = excluded.acct,
       profile_id = excluded.profile_id,
       updated_at = excluded.updated_at;`,
    {
      bind: [
        serverId,
        backendUrl,
        '', // backend_type — caller が必要に応じて設定
        account.acct,
        account.id,
        profileId,
        now,
        now,
      ],
    },
  )
  return { changedTables: [] }
}

// ================================================================
// カスタム絵文字カタログの一括登録
// ================================================================

export function handleBulkUpsertCustomEmojis(
  db: DbExec,
  backendUrl: string,
  emojisJson: string,
): HandlerResult {
  const emojis = JSON.parse(emojisJson) as {
    shortcode: string
    url: string
    static_url?: string | null
    visible_in_picker?: boolean
  }[]
  if (emojis.length === 0) return { changedTables: [] }

  db.exec('BEGIN;')
  try {
    const host = extractHost(backendUrl)
    const serverId = ensureServer(db, host)
    for (const emoji of emojis) {
      ensureCustomEmoji(db, serverId, emoji)
    }
    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: [] }
}
