import type { DbExec } from '../types'

export function createTimelineTables(db: DbExec): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS timeline_entries (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      local_account_id  INTEGER NOT NULL,
      timeline_key      TEXT    NOT NULL,
      post_id           INTEGER NOT NULL,
      display_post_id   INTEGER,
      created_at_ms     INTEGER NOT NULL,
      UNIQUE(local_account_id, timeline_key, post_id),
      FOREIGN KEY (local_account_id) REFERENCES local_accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (post_id)          REFERENCES posts(id)          ON DELETE CASCADE,
      FOREIGN KEY (display_post_id)  REFERENCES posts(id)          ON DELETE SET NULL
    );
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_timeline_entries_feed
      ON timeline_entries(local_account_id, timeline_key, created_at_ms DESC);
  `)
}
