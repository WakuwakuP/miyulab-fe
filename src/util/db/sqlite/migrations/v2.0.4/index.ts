import type { SchemaDbHandle } from '../../worker/workerSchema'
import type { Migration } from '../types'

/**
 * v2.0.4 マイグレーション — profiles の重複統合 + canonical_acct UNIQUE 化
 *
 * 同一 Fediverse ユーザーが異なるサーバー経由で別々の profile_id を持つ問題を修正。
 *
 * Phase 1: 重複プロフィールの統合
 *   - canonical_acct が同じ行のうち最小 id を "winner" とし、残りを "loser" とする
 *   - loser を参照する全 FK を winner に付け替え
 *   - loser 行を削除 (CASCADE で profile_stats / profile_fields / profile_custom_emojis も削除)
 *
 * Phase 2: UNIQUE INDEX 追加
 *   - 既存の非 UNIQUE インデックス idx_profiles_canonical_acct を DROP
 *   - canonical_acct に UNIQUE INDEX を作成
 *   - テーブル再作成は不要 (PRAGMA foreign_keys = OFF がトランザクション内で効かないため)
 *   - 旧 UNIQUE(username, server_id) テーブル制約は残るが、
 *     ensureProfile が ON CONFLICT(canonical_acct) を使うため実質無害
 */
export const v2_0_4_migration: Migration = {
  description:
    'Merge duplicate profiles and add UNIQUE index on canonical_acct for cross-server identity dedup',

  up(handle: SchemaDbHandle) {
    const { db } = handle

    // ----------------------------------------------------------------
    // Phase 1: 重複プロフィールの統合
    // ----------------------------------------------------------------

    // 1-1. loser → winner のマッピングテーブルを作成
    db.exec(`
      CREATE TABLE _profile_merge_map (
        loser_id  INTEGER NOT NULL,
        winner_id INTEGER NOT NULL
      );
    `)

    db.exec(`
      INSERT INTO _profile_merge_map (loser_id, winner_id)
      SELECT p.id, w.winner_id
      FROM profiles p
      INNER JOIN (
        SELECT canonical_acct, MIN(id) AS winner_id
        FROM profiles
        WHERE canonical_acct != ''
        GROUP BY canonical_acct
        HAVING COUNT(*) > 1
      ) w ON p.canonical_acct = w.canonical_acct AND p.id != w.winner_id;
    `)

    // マッピングが空の場合は Phase 1 をスキップ
    const mapCount = db.exec('SELECT COUNT(*) FROM _profile_merge_map;', {
      returnValue: 'resultRows',
    }) as number[][]

    if (mapCount[0][0] > 0) {
      // 1-2. FK 参照を winner に付け替え (CASCADE でないテーブル)

      // posts.author_profile_id
      db.exec(`
        UPDATE posts SET author_profile_id = (
          SELECT m.winner_id FROM _profile_merge_map m
          WHERE m.loser_id = posts.author_profile_id
        )
        WHERE author_profile_id IN (SELECT loser_id FROM _profile_merge_map);
      `)

      // post_mentions.profile_id
      db.exec(`
        UPDATE post_mentions SET profile_id = (
          SELECT m.winner_id FROM _profile_merge_map m
          WHERE m.loser_id = post_mentions.profile_id
        )
        WHERE profile_id IN (SELECT loser_id FROM _profile_merge_map);
      `)

      // notifications.actor_profile_id
      db.exec(`
        UPDATE notifications SET actor_profile_id = (
          SELECT m.winner_id FROM _profile_merge_map m
          WHERE m.loser_id = notifications.actor_profile_id
        )
        WHERE actor_profile_id IN (SELECT loser_id FROM _profile_merge_map);
      `)

      // local_accounts.profile_id
      db.exec(`
        UPDATE local_accounts SET profile_id = (
          SELECT m.winner_id FROM _profile_merge_map m
          WHERE m.loser_id = local_accounts.profile_id
        )
        WHERE profile_id IN (SELECT loser_id FROM _profile_merge_map);
      `)

      // profiles.moved_to_profile_id (自己参照)
      db.exec(`
        UPDATE profiles SET moved_to_profile_id = (
          SELECT m.winner_id FROM _profile_merge_map m
          WHERE m.loser_id = profiles.moved_to_profile_id
        )
        WHERE moved_to_profile_id IN (SELECT loser_id FROM _profile_merge_map);
      `)

      // 1-3. loser プロフィールを削除
      //   profile_stats, profile_fields, profile_custom_emojis は ON DELETE CASCADE で自動削除
      db.exec(`
        DELETE FROM profiles
        WHERE id IN (SELECT loser_id FROM _profile_merge_map);
      `)
    }

    // 1-4. マッピングテーブルを削除
    db.exec('DROP TABLE _profile_merge_map;')

    // ----------------------------------------------------------------
    // Phase 2: canonical_acct に UNIQUE INDEX を追加
    // ----------------------------------------------------------------
    // テーブル再作成 (recreateTable) は PRAGMA foreign_keys = OFF が
    // トランザクション内で効かないため使用しない。
    // 代わりに既存の非 UNIQUE インデックスを UNIQUE インデックスに置き換える。
    // ON CONFLICT(canonical_acct) は UNIQUE INDEX でも動作する。

    db.exec('DROP INDEX IF EXISTS idx_profiles_canonical_acct;')
    db.exec(
      'CREATE UNIQUE INDEX idx_profiles_canonical_acct ON profiles(canonical_acct);',
    )
  },

  validate(handle: SchemaDbHandle): boolean {
    const { db } = handle

    // canonical_acct の重複がないこと
    const dupRows = db.exec(
      `SELECT COUNT(*) FROM (
        SELECT canonical_acct FROM profiles
        WHERE canonical_acct != ''
        GROUP BY canonical_acct
        HAVING COUNT(*) > 1
      );`,
      { returnValue: 'resultRows' },
    ) as number[][]
    if (dupRows[0][0] > 0) {
      console.error(
        `Validation failed: ${dupRows[0][0]} canonical_acct groups still have duplicates`,
      )
      return false
    }

    // canonical_acct の UNIQUE インデックスが存在するか確認
    const indexRows = db.exec(
      "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_profiles_canonical_acct';",
      { returnValue: 'resultRows' },
    ) as string[][]
    if (indexRows.length === 0) {
      console.error(
        'Validation failed: idx_profiles_canonical_acct index not found',
      )
      return false
    }
    const indexSql = indexRows[0][0]
    if (!indexSql.includes('UNIQUE')) {
      console.error(
        'Validation failed: idx_profiles_canonical_acct is not a UNIQUE index',
      )
      return false
    }

    return true
  },

  version: { major: 2, minor: 0, patch: 4 },
}
