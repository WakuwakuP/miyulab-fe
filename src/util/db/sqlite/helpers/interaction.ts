import type { DbExecCompat } from './types'

// ================================================================
// エンゲージメント操作ヘルパー（Worker 共通）
// ================================================================

/** action コード ('favourited' → 'favourite' 等) をエンゲージメントコードに変換 */
export const ACTION_TO_ENGAGEMENT: Record<string, string> = {
  bookmarked: 'bookmark',
  favourited: 'favourite',
  reblogged: 'reblog',
}

export function toggleEngagement(
  db: DbExecCompat,
  localAccountId: number,
  postId: number,
  engagementCode: string,
  value: boolean,
): void {
  if (value) {
    db.exec(
      `INSERT OR IGNORE INTO post_engagements (
        local_account_id, post_id, engagement_type_id, created_at
      ) VALUES (
        ?, ?,
        (SELECT engagement_type_id FROM engagement_types WHERE code = ?),
        datetime('now')
      );`,
      { bind: [localAccountId, postId, engagementCode] },
    )
  } else {
    db.exec(
      `DELETE FROM post_engagements
       WHERE local_account_id = ? AND post_id = ?
         AND engagement_type_id = (SELECT engagement_type_id FROM engagement_types WHERE code = ?)
         AND emoji_id IS NULL;`,
      { bind: [localAccountId, postId, engagementCode] },
    )
  }
}

/**
 * リアクションのトグル。
 * 「投稿に1件」: 既存リアクションがあれば置き換え、なければ追加。
 */
export function toggleReaction(
  db: DbExecCompat,
  localAccountId: number,
  postId: number,
  value: boolean,
  emojiId: number | null,
  emojiText: string | null,
): void {
  const reactionTypeId = (
    db.exec(
      "SELECT engagement_type_id FROM engagement_types WHERE code = 'reaction';",
      { returnValue: 'resultRows' },
    ) as number[][]
  )[0][0]

  if (value) {
    // 既存のリアクションを削除してから新しいものを挿入（投稿に1件の制約）
    db.exec(
      `DELETE FROM post_engagements
       WHERE local_account_id = ? AND post_id = ? AND engagement_type_id = ?;`,
      { bind: [localAccountId, postId, reactionTypeId] },
    )
    db.exec(
      `INSERT INTO post_engagements (
        local_account_id, post_id, engagement_type_id, emoji_id, emoji_text, created_at
      ) VALUES (?, ?, ?, ?, ?, datetime('now'));`,
      { bind: [localAccountId, postId, reactionTypeId, emojiId, emojiText] },
    )
  } else {
    db.exec(
      `DELETE FROM post_engagements
       WHERE local_account_id = ? AND post_id = ? AND engagement_type_id = ?;`,
      { bind: [localAccountId, postId, reactionTypeId] },
    )
  }
}
