import type { SchemaDbHandle } from '../../worker/workerSchema'
import { recreateTable } from '../helpers'
import type { Migration } from '../types'

/**
 * v2.0.4 マイグレーション — profiles テーブルの UNIQUE 制約変更
 *
 * 同一 Fediverse ユーザーが異なるサーバー経由で別々の profile_id を持つ問題を修正。
 *
 * Phase 1: 重複プロフィールの統合
 *   - canonical_acct が同じ行のうち最小 id を "winner" とし、残りを "loser" とする
 *   - loser を参照する全 FK を winner に付け替え
 *   - loser 行を削除 (CASCADE で profile_stats / profile_fields / profile_custom_emojis も削除)
 *
 * Phase 2: テーブル再作成
 *   - UNIQUE(username, server_id) → UNIQUE(canonical_acct) に変更
 *   - recreateTable ヘルパーでバックアップリネーム方式により安全に実施
 */
export const v2_0_4_migration: Migration = {
  description:
    'Merge duplicate profiles and change UNIQUE constraint from (username, server_id) to (canonical_acct)',

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
    // Phase 2: テーブル再作成 (UNIQUE 制約変更)
    // ----------------------------------------------------------------

    const newCreateSql = `
      CREATE TABLE profiles (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_uri           TEXT,
        username            TEXT    NOT NULL,
        server_id           INTEGER NOT NULL,
        acct                TEXT    NOT NULL,
        canonical_acct      TEXT    NOT NULL DEFAULT '',
        display_name        TEXT    NOT NULL DEFAULT '',
        url                 TEXT    NOT NULL DEFAULT '',
        avatar_url          TEXT    NOT NULL DEFAULT '',
        avatar_static_url   TEXT    NOT NULL DEFAULT '',
        header_url          TEXT    NOT NULL DEFAULT '',
        header_static_url   TEXT    NOT NULL DEFAULT '',
        bio                 TEXT    NOT NULL DEFAULT '',
        is_locked           INTEGER NOT NULL DEFAULT 0,
        is_bot              INTEGER,
        created_at          TEXT    NOT NULL DEFAULT '',
        moved_to_profile_id INTEGER,
        last_fetched_at     INTEGER,
        is_detail_fetched   INTEGER NOT NULL DEFAULT 0,
        UNIQUE(canonical_acct),
        FOREIGN KEY (server_id)           REFERENCES servers(id),
        FOREIGN KEY (moved_to_profile_id) REFERENCES profiles(id)
      );
    `

    const columns = [
      'id',
      'actor_uri',
      'username',
      'server_id',
      'acct',
      'canonical_acct',
      'display_name',
      'url',
      'avatar_url',
      'avatar_static_url',
      'header_url',
      'header_static_url',
      'bio',
      'is_locked',
      'is_bot',
      'created_at',
      'moved_to_profile_id',
      'last_fetched_at',
      'is_detail_fetched',
    ].join(', ')

    recreateTable(db, 'profiles', newCreateSql, columns, undefined, {
      postSql: [
        // インデックスを再作成
        'CREATE INDEX IF NOT EXISTS idx_profiles_acct ON profiles(acct);',
        'CREATE INDEX IF NOT EXISTS idx_profiles_actor_uri ON profiles(actor_uri) WHERE actor_uri IS NOT NULL;',
        'CREATE INDEX IF NOT EXISTS idx_profiles_server ON profiles(server_id);',
        'PRAGMA foreign_keys = ON;',
      ],
      preSql: ['PRAGMA foreign_keys = OFF;'],
    })
  },

  validate(handle: SchemaDbHandle): boolean {
    const { db } = handle

    // UNIQUE(canonical_acct) が効いているか確認 — 重複がないこと
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
    const indexInfo = db.exec(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='profiles';",
      { returnValue: 'resultRows' },
    ) as string[][]
    if (indexInfo.length > 0) {
      const createSql = indexInfo[0][0]
      if (!createSql.includes('UNIQUE(canonical_acct)')) {
        console.error(
          'Validation failed: profiles table does not have UNIQUE(canonical_acct) constraint',
        )
        return false
      }
    }

    return true
  },

  version: { major: 2, minor: 0, patch: 4 },
}
