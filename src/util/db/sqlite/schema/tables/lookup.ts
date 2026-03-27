import type { DbExec } from '../types'

export function createLookupTables(db: DbExec): void {
  // servers テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      host TEXT NOT NULL UNIQUE
    );
  `)

  // visibility_types テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS visibility_types (
      id   INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );
  `)

  // media_types テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_types (
      id   INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );
  `)

  // notification_types テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_types (
      id   INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );
  `)

  // card_types テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_types (
      id   INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );
  `)

  // シードデータ
  db.exec(`
    INSERT OR IGNORE INTO visibility_types (id, name) VALUES
      (1, 'public'), (2, 'unlisted'), (3, 'private'), (4, 'direct'), (5, 'local');
  `)

  db.exec(`
    INSERT OR IGNORE INTO media_types (id, name) VALUES
      (0, 'unknown'), (1, 'image'), (2, 'gifv'), (3, 'video'), (4, 'audio');
  `)

  db.exec(`
    INSERT OR IGNORE INTO notification_types (id, name) VALUES
      (1,  'follow'),
      (2,  'favourite'),
      (3,  'reblog'),
      (4,  'mention'),
      (5,  'reaction'),
      (6,  'follow_request'),
      (7,  'status'),
      (8,  'poll_vote'),
      (9,  'poll_expired'),
      (10, 'update'),
      (11, 'move'),
      (12, 'admin_signup'),
      (13, 'admin_report'),
      (14, 'follow_request_accepted'),
      (100, 'login_bonus'),
      (101, 'create_token'),
      (102, 'export_completed'),
      (103, 'login'),
      (199, 'unknown');
  `)

  db.exec(`
    INSERT OR IGNORE INTO card_types (id, name) VALUES
      (1, 'link'), (2, 'photo'), (3, 'video'), (4, 'rich');
  `)

  // muted_accounts テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS muted_accounts (
      server_id    INTEGER NOT NULL,
      account_acct TEXT    NOT NULL,
      muted_at     INTEGER NOT NULL,
      PRIMARY KEY (server_id, account_acct),
      FOREIGN KEY (server_id) REFERENCES servers(id)
    );
  `)

  // blocked_instances テーブル
  db.exec(`
    CREATE TABLE IF NOT EXISTS blocked_instances (
      instance_domain TEXT PRIMARY KEY NOT NULL,
      blocked_at      INTEGER NOT NULL
    );
  `)
}
