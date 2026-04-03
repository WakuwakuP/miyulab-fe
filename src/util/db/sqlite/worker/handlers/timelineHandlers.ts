/**
 * タイムライン関連のハンドラ群
 *
 * 新スキーマ対応版:
 * - timelines + timeline_items → timeline_entries 単一テーブル
 * - posts_backends → post_backend_ids
 * - channel_kinds JOIN 不要（timeline_key は文字列）
 * - post_id PK名 → id に変更（posts テーブル）
 */

import type { DbExecCompat } from '../../helpers/types'
import type { HandlerResult } from './types'

export function handleRemoveFromTimeline(
  db: DbExecCompat,
  localAccountId: number,
  timelineKey: string,
  postId: number,
): HandlerResult {
  db.exec('BEGIN;')
  try {
    // 該当タイムラインエントリを削除
    db.exec(
      'DELETE FROM timeline_entries WHERE local_account_id = ? AND timeline_key = ? AND post_id = ?;',
      { bind: [localAccountId, timelineKey, postId] },
    )

    // 孤立投稿チェック: timeline_entries にも notifications にもない投稿を削除
    const remainingTimelines = (
      db.exec('SELECT COUNT(*) FROM timeline_entries WHERE post_id = ?;', {
        bind: [postId],
        returnValue: 'resultRows',
      }) as number[][]
    )[0][0]

    if (remainingTimelines === 0) {
      const remainingNotifications = (
        db.exec(
          'SELECT COUNT(*) FROM notifications WHERE related_post_id = ?;',
          { bind: [postId], returnValue: 'resultRows' },
        ) as number[][]
      )[0][0]

      if (remainingNotifications === 0) {
        db.exec('DELETE FROM posts WHERE id = ?;', {
          bind: [postId],
        })
      }
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['posts', 'timeline_entries'] }
}

export function handleDeleteEvent(
  db: DbExecCompat,
  localAccountId: number,
  localId: string,
): HandlerResult {
  // 1. post_backend_ids から local_account_id + local_id で post_id を取得
  const rows = db.exec(
    'SELECT post_id FROM post_backend_ids WHERE local_account_id = ? AND local_id = ?;',
    { bind: [localAccountId, localId], returnValue: 'resultRows' },
  ) as number[][]

  if (rows.length === 0) return { changedTables: [] }

  const postId = rows[0][0]

  db.exec('BEGIN;')
  try {
    // 2. post_backend_ids からエントリを削除
    db.exec(
      'DELETE FROM post_backend_ids WHERE local_account_id = ? AND local_id = ?;',
      { bind: [localAccountId, localId] },
    )

    // 3. 他のアカウントが同じ投稿を参照していないかチェック
    const remainingBackends = (
      db.exec('SELECT COUNT(*) FROM post_backend_ids WHERE post_id = ?;', {
        bind: [postId],
        returnValue: 'resultRows',
      }) as number[][]
    )[0][0]

    // 4. 参照がなければ posts を削除（CASCADE で関連テーブルも削除）
    if (remainingBackends === 0) {
      db.exec('DELETE FROM posts WHERE id = ?;', {
        bind: [postId],
      })
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['posts'] }
}
