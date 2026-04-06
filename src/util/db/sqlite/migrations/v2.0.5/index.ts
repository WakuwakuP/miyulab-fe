import type { SchemaDbHandle } from '../../worker/workerSchema'
import type { Migration } from '../types'

/**
 * v2.0.5 マイグレーション — profiles に UNIQUE(username, server_id) を追加
 *
 * v2.0.0 で createFreshSchema が作成した profiles テーブルには
 * UNIQUE(canonical_acct) のみが定義されており、UNIQUE(username, server_id) が
 * 欠落していた。ensureProfile の dual ON CONFLICT チェーンが
 * 「2nd ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint」
 * で失敗する原因となっていた。
 *
 * Phase 1: (username, server_id) の重複を統合
 *   - 同一 (username, server_id) のうち最小 id を winner とし、残りを loser とする
 *   - loser を参照する全 FK を winner に付け替え
 *   - loser 行を削除
 *
 * Phase 2: UNIQUE INDEX 追加
 *   - (username, server_id) に UNIQUE INDEX を作成
 */
export const v2_0_5_migration: Migration = {
  description:
    'Add missing UNIQUE(username, server_id) constraint to profiles table',

  up(handle: SchemaDbHandle) {
    const { db } = handle

    // すでに UNIQUE INDEX が存在するか確認（冪等性）
    const existingIdx = db.exec(
      "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_profiles_username_server';",
      { returnValue: 'resultRows' },
    ) as string[][]
    if (existingIdx.length > 0) return

    // ----------------------------------------------------------------
    // Phase 1: (username, server_id) 重複の統合
    // ----------------------------------------------------------------

    db.exec(`
      CREATE TABLE _profile_merge_map_v205 (
        loser_id  INTEGER NOT NULL,
        winner_id INTEGER NOT NULL
      );
    `)

    db.exec(`
      INSERT INTO _profile_merge_map_v205 (loser_id, winner_id)
      SELECT p.id, w.winner_id
      FROM profiles p
      INNER JOIN (
        SELECT username, server_id, MIN(id) AS winner_id
        FROM profiles
        GROUP BY username, server_id
        HAVING COUNT(*) > 1
      ) w ON p.username = w.username
         AND p.server_id = w.server_id
         AND p.id != w.winner_id;
    `)

    const mapCount = db.exec('SELECT COUNT(*) FROM _profile_merge_map_v205;', {
      returnValue: 'resultRows',
    }) as number[][]

    if (mapCount[0][0] > 0) {
      // FK 参照を winner に付け替え

      // posts.author_profile_id
      db.exec(`
        UPDATE posts SET author_profile_id = (
          SELECT m.winner_id FROM _profile_merge_map_v205 m
          WHERE m.loser_id = posts.author_profile_id
        )
        WHERE author_profile_id IN (SELECT loser_id FROM _profile_merge_map_v205);
      `)

      // post_mentions.profile_id
      db.exec(`
        UPDATE post_mentions SET profile_id = (
          SELECT m.winner_id FROM _profile_merge_map_v205 m
          WHERE m.loser_id = post_mentions.profile_id
        )
        WHERE profile_id IN (SELECT loser_id FROM _profile_merge_map_v205);
      `)

      // notifications.actor_profile_id
      db.exec(`
        UPDATE notifications SET actor_profile_id = (
          SELECT m.winner_id FROM _profile_merge_map_v205 m
          WHERE m.loser_id = notifications.actor_profile_id
        )
        WHERE actor_profile_id IN (SELECT loser_id FROM _profile_merge_map_v205);
      `)

      // local_accounts.profile_id
      db.exec(`
        UPDATE local_accounts SET profile_id = (
          SELECT m.winner_id FROM _profile_merge_map_v205 m
          WHERE m.loser_id = local_accounts.profile_id
        )
        WHERE profile_id IN (SELECT loser_id FROM _profile_merge_map_v205);
      `)

      // profiles.moved_to_profile_id
      db.exec(`
        UPDATE profiles SET moved_to_profile_id = (
          SELECT m.winner_id FROM _profile_merge_map_v205 m
          WHERE m.loser_id = profiles.moved_to_profile_id
        )
        WHERE moved_to_profile_id IN (SELECT loser_id FROM _profile_merge_map_v205);
      `)

      // loser 行を削除 (CASCADE で profile_stats, profile_fields, profile_custom_emojis も削除)
      db.exec(`
        DELETE FROM profiles
        WHERE id IN (SELECT loser_id FROM _profile_merge_map_v205);
      `)
    }

    db.exec('DROP TABLE _profile_merge_map_v205;')

    // ----------------------------------------------------------------
    // Phase 2: UNIQUE INDEX 追加
    // ----------------------------------------------------------------
    db.exec(
      'CREATE UNIQUE INDEX idx_profiles_username_server ON profiles(username, server_id);',
    )
  },

  validate(handle: SchemaDbHandle): boolean {
    const { db } = handle

    // (username, server_id) の重複がないこと
    const dupRows = db.exec(
      `SELECT COUNT(*) FROM (
        SELECT username, server_id FROM profiles
        GROUP BY username, server_id
        HAVING COUNT(*) > 1
      );`,
      { returnValue: 'resultRows' },
    ) as number[][]
    if (dupRows[0][0] > 0) {
      console.error(
        `Validation failed: ${dupRows[0][0]} (username, server_id) groups still have duplicates`,
      )
      return false
    }

    // UNIQUE INDEX が存在すること
    const indexRows = db.exec(
      "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_profiles_username_server';",
      { returnValue: 'resultRows' },
    ) as string[][]
    if (indexRows.length === 0) {
      console.error(
        'Validation failed: idx_profiles_username_server index not found',
      )
      return false
    }
    const indexSql = indexRows[0][0]
    if (!indexSql.includes('UNIQUE')) {
      console.error(
        'Validation failed: idx_profiles_username_server is not a UNIQUE index',
      )
      return false
    }

    return true
  },

  version: { major: 2, minor: 0, patch: 5 },
}
