import type { DbExec } from '../types'

export function createPollTables(db: DbExec): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS polls (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id       INTEGER NOT NULL UNIQUE,
      poll_local_id TEXT,
      expires_at    TEXT,
      expired       INTEGER NOT NULL DEFAULT 0,
      multiple      INTEGER NOT NULL DEFAULT 0,
      votes_count   INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS poll_votes (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id           INTEGER NOT NULL,
      local_account_id  INTEGER NOT NULL,
      voted             INTEGER NOT NULL DEFAULT 0,
      own_votes_json    TEXT,
      UNIQUE(poll_id, local_account_id),
      FOREIGN KEY (poll_id)          REFERENCES polls(id)          ON DELETE CASCADE,
      FOREIGN KEY (local_account_id) REFERENCES local_accounts(id) ON DELETE CASCADE
    );
  `)
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes(poll_id);`,
  )

  db.exec(`
    CREATE TABLE IF NOT EXISTS poll_options (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id     INTEGER NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      title       TEXT    NOT NULL,
      votes_count INTEGER,
      FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
    );
  `)
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options(poll_id);`,
  )
}
