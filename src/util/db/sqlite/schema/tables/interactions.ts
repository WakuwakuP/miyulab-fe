import type { DbExec } from '../types'

export function createInteractionTables(db: DbExec): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS post_interactions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id           INTEGER NOT NULL,
      local_account_id  INTEGER NOT NULL,
      is_favourited     INTEGER,
      is_reblogged      INTEGER,
      is_bookmarked     INTEGER NOT NULL DEFAULT 0,
      is_muted          INTEGER,
      is_pinned         INTEGER,
      my_reaction_name  TEXT,
      my_reaction_url   TEXT,
      updated_at        INTEGER NOT NULL,
      UNIQUE(post_id, local_account_id),
      FOREIGN KEY (post_id)          REFERENCES posts(id)          ON DELETE CASCADE,
      FOREIGN KEY (local_account_id) REFERENCES local_accounts(id) ON DELETE CASCADE
    );
  `)

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_post_interactions_account ON post_interactions(local_account_id);`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_post_interactions_bookmarked ON post_interactions(local_account_id, is_bookmarked) WHERE is_bookmarked = 1;`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_post_interactions_favourited ON post_interactions(local_account_id, is_favourited) WHERE is_favourited = 1;`,
  )

  db.exec(`
    CREATE TABLE IF NOT EXISTS post_emoji_reactions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id    INTEGER NOT NULL,
      name       TEXT    NOT NULL,
      url        TEXT,
      static_url TEXT,
      count      INTEGER NOT NULL DEFAULT 0,
      UNIQUE(post_id, name),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );
  `)
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_post_emoji_reactions_post ON post_emoji_reactions(post_id);`,
  )
}
