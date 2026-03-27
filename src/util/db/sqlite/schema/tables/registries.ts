import type { DbExec } from '../types'

export function createRegistryTables(db: DbExec): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_emojis (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      shortcode         TEXT    NOT NULL,
      server_id         INTEGER NOT NULL,
      url               TEXT    NOT NULL,
      static_url        TEXT    NOT NULL,
      visible_in_picker INTEGER NOT NULL DEFAULT 1,
      category          TEXT,
      UNIQUE(shortcode, server_id),
      FOREIGN KEY (server_id) REFERENCES servers(id)
    );
  `)
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_custom_emojis_server ON custom_emojis(server_id);`,
  )

  db.exec(`
    CREATE TABLE IF NOT EXISTS hashtags (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      url  TEXT
    );
  `)
}
