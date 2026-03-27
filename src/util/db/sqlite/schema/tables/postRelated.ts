import type { DbExec } from '../types'

export function createPostRelatedTables(db: DbExec): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS post_media (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id        INTEGER NOT NULL,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      media_type_id  INTEGER NOT NULL,
      url            TEXT    NOT NULL,
      width          INTEGER,
      height         INTEGER,
      remote_url     TEXT,
      preview_url    TEXT,
      description    TEXT,
      blurhash       TEXT,
      media_local_id TEXT,
      FOREIGN KEY (post_id)       REFERENCES posts(id)       ON DELETE CASCADE,
      FOREIGN KEY (media_type_id) REFERENCES media_types(id)
    );
  `)
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_post_media_post ON post_media(post_id);`,
  )

  db.exec(`
    CREATE TABLE IF NOT EXISTS post_mentions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id    INTEGER NOT NULL,
      acct       TEXT    NOT NULL,
      username   TEXT    NOT NULL,
      url        TEXT    NOT NULL,
      profile_id INTEGER,
      UNIQUE(post_id, acct),
      FOREIGN KEY (post_id)    REFERENCES posts(id)    ON DELETE CASCADE,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL
    );
  `)
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_post_mentions_post ON post_mentions(post_id);`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_post_mentions_acct ON post_mentions(acct);`,
  )

  db.exec(`
    CREATE TABLE IF NOT EXISTS post_hashtags (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id    INTEGER NOT NULL,
      hashtag_id INTEGER NOT NULL,
      UNIQUE(post_id, hashtag_id),
      FOREIGN KEY (post_id)    REFERENCES posts(id)    ON DELETE CASCADE,
      FOREIGN KEY (hashtag_id) REFERENCES hashtags(id) ON DELETE CASCADE
    );
  `)
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_post_hashtags_post ON post_hashtags(post_id);`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_post_hashtags_hashtag ON post_hashtags(hashtag_id);`,
  )

  db.exec(`
    CREATE TABLE IF NOT EXISTS post_custom_emojis (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id         INTEGER NOT NULL,
      custom_emoji_id INTEGER NOT NULL,
      UNIQUE(post_id, custom_emoji_id),
      FOREIGN KEY (post_id)         REFERENCES posts(id)         ON DELETE CASCADE,
      FOREIGN KEY (custom_emoji_id) REFERENCES custom_emojis(id) ON DELETE CASCADE
    );
  `)
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_post_custom_emojis_post ON post_custom_emojis(post_id);`,
  )
}
