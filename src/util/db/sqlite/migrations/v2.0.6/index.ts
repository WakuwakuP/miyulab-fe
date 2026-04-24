import type { SchemaDbHandle } from '../../worker/workerSchema'
import type { Migration } from '../types'

/**
 * v2.0.6 マイグレーション — timeline_entries(post_id) にインデックスを追加
 *
 * 孤立 posts クリーンアップ (handleEnforceMaxLength の Phase 2) では
 * `NOT EXISTS (SELECT 1 FROM timeline_entries te WHERE te.post_id = p.id)` を
 * posts の各行について評価する。
 *
 * timeline_entries の UNIQUE 制約は (local_account_id, timeline_key, post_id) で
 * あり post_id が 3 列目のため、post_id 単独検索ではこのインデックスが
 * 使えず、posts × timeline_entries の全件スキャンが発生して 90 秒の
 * Worker タイムアウトを引き起こしていた。
 *
 * 本マイグレーションで post_id 単独のインデックスを追加し、孤立 posts
 * クリーンアップが確実にインデックススキャンで走るようにする。
 */
export const v2_0_6_migration: Migration = {
  description:
    'Add idx_timeline_entries_post index on timeline_entries(post_id) for orphan posts cleanup performance',

  up(handle: SchemaDbHandle) {
    const { db } = handle

    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_timeline_entries_post ON timeline_entries(post_id);',
    )
  },

  validate(handle: SchemaDbHandle): boolean {
    const { db } = handle

    const rows = db.exec(
      "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_timeline_entries_post';",
      { returnValue: 'resultRows' },
    ) as string[][]
    if (rows.length === 0) {
      console.error(
        'Validation failed: idx_timeline_entries_post index not found',
      )
      return false
    }
    return true
  },

  version: { major: 2, minor: 0, patch: 6 },
}
