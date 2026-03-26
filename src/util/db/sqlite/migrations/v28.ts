/**
 * マイグレーション v27 → v28
 *
 * 変更内容:
 * - posts: reply_to_post_id, repost_of_post_id カラム追加 + インデックス
 * - posts_mentions: profile_id カラム追加
 * - timelines: local_account_id カラム追加 + ユニークインデックス再作成
 * - notifications: local_account_id カラム追加
 * - local_accounts: is_active, last_used_at_ms カラム追加
 */
import type { Migration } from './types'

export const v28Migration: Migration = {
  description:
    'Add reply/repost references, profile_id on mentions, local_account_id on timelines/notifications, active flag on local_accounts',

  up(handle) {
    const { db } = handle

    // ── posts: 返信・リポスト参照カラム ──────────────────────
    db.exec(
      'ALTER TABLE posts ADD COLUMN reply_to_post_id INTEGER REFERENCES posts(post_id);',
    )
    db.exec(
      'ALTER TABLE posts ADD COLUMN repost_of_post_id INTEGER REFERENCES posts(post_id);',
    )
    db.exec(
      'CREATE INDEX idx_posts_reply_to ON posts(reply_to_post_id) WHERE reply_to_post_id IS NOT NULL;',
    )
    db.exec(
      'CREATE INDEX idx_posts_repost_of ON posts(repost_of_post_id) WHERE repost_of_post_id IS NOT NULL;',
    )

    // 既存データの解決: in_reply_to_id → reply_to_post_id
    db.exec(`
      UPDATE posts
      SET reply_to_post_id = (
        SELECT pb.post_id
        FROM posts_backends pb
        WHERE pb.local_id = posts.in_reply_to_id
        LIMIT 1
      )
      WHERE posts.in_reply_to_id IS NOT NULL;
    `)

    // 既存データの解決: reblog_of_uri → repost_of_post_id
    db.exec(`
      UPDATE posts
      SET repost_of_post_id = (
        SELECT p2.post_id
        FROM posts p2
        WHERE p2.object_uri = posts.reblog_of_uri
          AND p2.object_uri != ''
        LIMIT 1
      )
      WHERE posts.reblog_of_uri IS NOT NULL;
    `)

    // ── posts_mentions: profile_id カラム ────────────────────
    db.exec(
      'ALTER TABLE posts_mentions ADD COLUMN profile_id INTEGER REFERENCES profiles(profile_id);',
    )
    db.exec(
      'CREATE INDEX idx_pm_profile ON posts_mentions(profile_id) WHERE profile_id IS NOT NULL;',
    )

    // ── timelines: local_account_id カラム + インデックス再作成 ─
    db.exec(
      'ALTER TABLE timelines ADD COLUMN local_account_id INTEGER REFERENCES local_accounts(local_account_id);',
    )
    db.exec('DROP INDEX IF EXISTS idx_timelines_identity;')
    db.exec(
      "CREATE UNIQUE INDEX idx_timelines_identity ON timelines(server_id, COALESCE(local_account_id, 0), channel_kind_id, COALESCE(tag, ''));",
    )

    // 既存データの解決: home/notification タイムラインに local_account_id をバックフィル
    db.exec(`
      UPDATE timelines
      SET local_account_id = (
        SELECT la.local_account_id
        FROM local_accounts la
        WHERE la.server_id = timelines.server_id
        LIMIT 1
      )
      WHERE channel_kind_id IN (
        SELECT channel_kind_id FROM channel_kinds WHERE code IN ('home', 'notification')
      );
    `)

    // ── notifications: local_account_id カラム ───────────────
    db.exec(
      'ALTER TABLE notifications ADD COLUMN local_account_id INTEGER REFERENCES local_accounts(local_account_id);',
    )

    // 既存データの解決: server_id → local_account_id
    db.exec(`
      UPDATE notifications
      SET local_account_id = (
        SELECT la.local_account_id
        FROM local_accounts la
        WHERE la.server_id = notifications.server_id
        LIMIT 1
      );
    `)
    db.exec(
      'CREATE INDEX idx_notifications_local_account ON notifications(local_account_id) WHERE local_account_id IS NOT NULL;',
    )

    // ── local_accounts: is_active, last_used_at_ms カラム ────
    db.exec(
      'ALTER TABLE local_accounts ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;',
    )
    db.exec('ALTER TABLE local_accounts ADD COLUMN last_used_at_ms INTEGER;')
  },

  validate(handle) {
    const { db } = handle

    const hasColumn = (table: string, column: string): boolean => {
      const rows = db.exec(`PRAGMA table_info(${table});`, {
        returnValue: 'resultRows',
      }) as (string | number | null)[][]
      return rows.some((row) => row[1] === column)
    }

    return (
      hasColumn('posts', 'reply_to_post_id') &&
      hasColumn('posts', 'repost_of_post_id') &&
      hasColumn('posts_mentions', 'profile_id') &&
      hasColumn('timelines', 'local_account_id') &&
      hasColumn('notifications', 'local_account_id') &&
      hasColumn('local_accounts', 'is_active') &&
      hasColumn('local_accounts', 'last_used_at_ms')
    )
  },
  version: 28,
}
