import type { DbExec } from '../types'

export function createPostTables(db: DbExec): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      object_uri              TEXT    NOT NULL DEFAULT '',
      canonical_url           TEXT,
      origin_server_id        INTEGER NOT NULL,
      author_profile_id       INTEGER NOT NULL,
      content_html            TEXT    NOT NULL DEFAULT '',
      created_at_ms           INTEGER NOT NULL,
      edited_at_ms            INTEGER,
      plain_content           TEXT,
      language                TEXT,
      is_sensitive            INTEGER NOT NULL DEFAULT 0,
      spoiler_text            TEXT    NOT NULL DEFAULT '',
      visibility_id           INTEGER NOT NULL,
      in_reply_to_uri         TEXT,
      in_reply_to_account_acct TEXT,
      reblog_of_post_id       INTEGER,
      quote_of_post_id        INTEGER,
      quote_state             TEXT,
      is_reblog               INTEGER NOT NULL DEFAULT 0,
      is_local_only           INTEGER NOT NULL DEFAULT 0,
      application_name        TEXT,
      last_fetched_at         INTEGER,
      FOREIGN KEY (origin_server_id)  REFERENCES servers(id),
      FOREIGN KEY (author_profile_id) REFERENCES profiles(id),
      FOREIGN KEY (visibility_id)     REFERENCES visibility_types(id),
      FOREIGN KEY (reblog_of_post_id) REFERENCES posts(id),
      FOREIGN KEY (quote_of_post_id)  REFERENCES posts(id)
    );
  `)

  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_object_uri ON posts(object_uri) WHERE object_uri != '';`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_profile_id);`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at_ms DESC);`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_posts_reblog_of ON posts(reblog_of_post_id) WHERE reblog_of_post_id IS NOT NULL;`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_posts_quote_of ON posts(quote_of_post_id) WHERE quote_of_post_id IS NOT NULL;`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_posts_reply ON posts(in_reply_to_uri) WHERE in_reply_to_uri IS NOT NULL;`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_posts_origin_server ON posts(origin_server_id);`,
  )

  db.exec(`
    CREATE TABLE IF NOT EXISTS post_backend_ids (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id           INTEGER NOT NULL,
      local_account_id  INTEGER NOT NULL,
      local_id          TEXT    NOT NULL,
      server_id         INTEGER NOT NULL,
      UNIQUE(local_account_id, local_id),
      UNIQUE(post_id, local_account_id),
      FOREIGN KEY (post_id)          REFERENCES posts(id)          ON DELETE CASCADE,
      FOREIGN KEY (local_account_id) REFERENCES local_accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (server_id)        REFERENCES servers(id)
    );
  `)

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_post_backend_ids_post ON post_backend_ids(post_id);`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_post_backend_ids_local ON post_backend_ids(local_id, local_account_id);`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_post_backend_ids_server ON post_backend_ids(server_id);`,
  )

  db.exec(`
    CREATE TABLE IF NOT EXISTS post_stats (
      post_id              INTEGER PRIMARY KEY,
      replies_count        INTEGER NOT NULL DEFAULT 0,
      reblogs_count        INTEGER NOT NULL DEFAULT 0,
      favourites_count     INTEGER NOT NULL DEFAULT 0,
      emoji_reactions_json TEXT    NOT NULL DEFAULT '[]',
      updated_at           INTEGER NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );
  `)
}
