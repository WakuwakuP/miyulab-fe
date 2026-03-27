/**
 * アカウント関連のハンドラ群
 *
 * workerStatusStore.ts から分割。ロジック変更なし。
 */

import type { Entity } from 'megalodon'
import {
  ensureCustomEmoji,
  ensureProfile,
  ensureProfileAlias,
  ensureServer,
  resolveLocalAccountId,
  syncProfileCustomEmojis,
} from '../../shared'
import type { DbExec, HandlerResult } from './types'

// ================================================================
// フォロー関係同期
// ================================================================

export function handleSyncFollows(
  db: DbExec,
  backendUrl: string,
  accountsJson: string[],
): HandlerResult {
  const localAccountId = resolveLocalAccountId(db, backendUrl)
  if (localAccountId === null) return { changedTables: [] }

  db.exec('BEGIN;')
  try {
    const serverId = ensureServer(db, backendUrl)
    // 現在のフォローを全削除して再構築
    db.exec('DELETE FROM follows WHERE local_account_id = ?;', {
      bind: [localAccountId],
    })

    for (const json of accountsJson) {
      const account = JSON.parse(json) as Entity.Account
      const profileId = ensureProfile(db, account)
      ensureProfileAlias(db, profileId, serverId, account.id)
      if (account.emojis.length > 0) {
        syncProfileCustomEmojis(db, profileId, serverId, account.emojis)
      }
      db.exec(
        `INSERT OR IGNORE INTO follows (local_account_id, target_profile_id, created_at)
         VALUES (?, ?, datetime('now'));`,
        { bind: [localAccountId, profileId] },
      )
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: [] }
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
  const serverId = ensureServer(db, backendUrl)
  const profileId = ensureProfile(db, account)
  ensureProfileAlias(db, profileId, serverId, account.id)
  if (account.emojis.length > 0) {
    syncProfileCustomEmojis(db, profileId, serverId, account.emojis)
  }
  db.exec(
    `INSERT INTO local_accounts (server_id, profile_id, last_authenticated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(server_id, profile_id) DO UPDATE SET
       last_authenticated_at = datetime('now');`,
    { bind: [serverId, profileId] },
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
    const serverId = ensureServer(db, backendUrl)
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
