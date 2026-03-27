import { createFreshSchema, dropAllTables } from '../../schema'
import type { SchemaDbHandle } from '../../worker/workerSchema'
import type { Migration } from '../types'

/**
 * v2.0.0 マイグレーション — 正規化スキーマ (28テーブル)
 *
 * v1.0.0（旧v28以下）→ v2.0.0: データ保持なし（DROP ALL + 再作成）
 * ブラウザキャッシュDBであり、サーバー側にマスターデータがあるためデータロストは許容。
 */
export const v2_0_0_migration: Migration = {
  description: 'Normalized schema v2.0.0 — 28 tables, semver, multi-account',

  up(handle: SchemaDbHandle) {
    // 全テーブルを削除して新スキーマで再作成
    dropAllTables(handle)
    createFreshSchema(handle)
  },

  validate(handle: SchemaDbHandle): boolean {
    const { db } = handle

    const requiredTables = [
      'servers',
      'visibility_types',
      'media_types',
      'notification_types',
      'card_types',
      'local_accounts',
      'profiles',
      'profile_stats',
      'profile_fields',
      'profile_custom_emojis',
      'posts',
      'post_backend_ids',
      'post_stats',
      'post_interactions',
      'post_emoji_reactions',
      'post_media',
      'post_mentions',
      'post_hashtags',
      'post_custom_emojis',
      'polls',
      'poll_votes',
      'poll_options',
      'link_cards',
      'custom_emojis',
      'hashtags',
      'notifications',
      'timeline_entries',
      'schema_version',
    ]

    for (const table of requiredTables) {
      const rows = db.exec(
        `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${table}';`,
        { returnValue: 'resultRows' },
      ) as number[][]
      if (rows[0][0] === 0) {
        console.error(`Validation failed: table '${table}' not found`)
        return false
      }
    }

    return true
  },
  version: { major: 2, minor: 0, patch: 0 },
}
