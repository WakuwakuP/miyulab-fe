import type { SchemaDbHandle } from '../../worker/workerSchema'
import type { Migration } from '../types'

/**
 * v2.0.7 マイグレーション — posts(canonical_url) にインデックスを追加
 *
 * タイムライン間で同じ投稿が別 rows として保持されている場合、インタラクション
 * 同期時に canonical_url から同等投稿を探す。投稿数が増えても同期処理が全件
 * スキャンにならないよう、非空 canonical_url に部分インデックスを追加する。
 */
export const v2_0_7_migration: Migration = {
  description:
    'Add idx_posts_canonical_url index for cross-timeline interaction sync',

  up(handle: SchemaDbHandle) {
    const { db } = handle

    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_posts_canonical_url ON posts(canonical_url) WHERE canonical_url IS NOT NULL AND canonical_url != '';",
    )
  },

  validate(handle: SchemaDbHandle): boolean {
    const { db } = handle

    const rows = db.exec(
      "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_posts_canonical_url';",
      { returnValue: 'resultRows' },
    ) as string[][]
    if (rows.length === 0) {
      console.error(
        'Validation failed: idx_posts_canonical_url index not found',
      )
      return false
    }
    return true
  },

  version: { major: 2, minor: 0, patch: 7 },
}
