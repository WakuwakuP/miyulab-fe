import type { WrittenTableCollector } from '../protocol'
import type { DbExecCompat } from './types'

// ================================================================
// インタラクション操作ヘルパー（Worker 共通）
// ================================================================

/** アクション名と post_interactions のカラム名のマッピング */
const ACTION_COLUMN_MAP: Record<string, string> = {
  bookmark: 'is_bookmarked',
  favourite: 'is_favourited',
  mute: 'is_muted',
  pin: 'is_pinned',
  reblog: 'is_reblogged',
}

/**
 * post_interactions テーブルの対応するブーリアンカラムを更新する。
 * レコードがなければ INSERT、あれば UPDATE（UPSERT）。
 */
export function updateInteraction(
  db: DbExecCompat,
  postId: number,
  localAccountId: number,
  action: string,
  value: boolean,
  collector?: WrittenTableCollector,
): void {
  const column = ACTION_COLUMN_MAP[action]
  if (!column) return

  const now = Date.now()
  db.exec(
    `INSERT INTO post_interactions (post_id, local_account_id, ${column}, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(post_id, local_account_id) DO UPDATE SET
       ${column} = excluded.${column},
       updated_at = excluded.updated_at;`,
    { bind: [postId, localAccountId, value ? 1 : 0, now] },
  )
  collector?.add('post_interactions')
}

/**
 * post_interactions の my_reaction_name / my_reaction_url を更新する。
 * name が null の場合はリアクションをクリアする。
 */
export function toggleReaction(
  db: DbExecCompat,
  postId: number,
  localAccountId: number,
  name: string | null,
  url: string | null,
): void {
  const now = Date.now()
  db.exec(
    `INSERT INTO post_interactions (post_id, local_account_id, my_reaction_name, my_reaction_url, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(post_id, local_account_id) DO UPDATE SET
       my_reaction_name = excluded.my_reaction_name,
       my_reaction_url = excluded.my_reaction_url,
       updated_at = excluded.updated_at;`,
    { bind: [postId, localAccountId, name, url, now] },
  )
}
