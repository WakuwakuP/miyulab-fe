import type { DbExec } from '../types'

export function createProfileTables(db: DbExec): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
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
      UNIQUE(username, server_id),
      FOREIGN KEY (server_id)           REFERENCES servers(id),
      FOREIGN KEY (moved_to_profile_id) REFERENCES profiles(id)
    );
  `)

  db.exec(`CREATE INDEX IF NOT EXISTS idx_profiles_acct ON profiles(acct);`)
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_profiles_canonical_acct ON profiles(canonical_acct);`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_profiles_actor_uri ON profiles(actor_uri) WHERE actor_uri IS NOT NULL;`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_profiles_server ON profiles(server_id);`,
  )

  db.exec(`
    CREATE TABLE IF NOT EXISTS profile_stats (
      profile_id      INTEGER PRIMARY KEY,
      followers_count INTEGER NOT NULL DEFAULT 0,
      following_count INTEGER NOT NULL DEFAULT 0,
      statuses_count  INTEGER NOT NULL DEFAULT 0,
      updated_at      INTEGER NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS profile_fields (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id  INTEGER NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      name        TEXT    NOT NULL,
      value       TEXT    NOT NULL,
      verified_at TEXT,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );
  `)
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_profile_fields_profile ON profile_fields(profile_id);`,
  )

  db.exec(`
    CREATE TABLE IF NOT EXISTS profile_custom_emojis (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id      INTEGER NOT NULL,
      custom_emoji_id INTEGER NOT NULL,
      UNIQUE(profile_id, custom_emoji_id),
      FOREIGN KEY (profile_id)      REFERENCES profiles(id)      ON DELETE CASCADE,
      FOREIGN KEY (custom_emoji_id) REFERENCES custom_emojis(id) ON DELETE CASCADE
    );
  `)
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_profile_custom_emojis_profile ON profile_custom_emojis(profile_id);`,
  )
}
