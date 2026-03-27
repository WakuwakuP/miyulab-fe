import type { DbExec } from '../types'

export function createAccountTables(db: DbExec): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_accounts (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id         INTEGER NOT NULL,
      backend_url       TEXT    NOT NULL,
      backend_type      TEXT    NOT NULL,
      acct              TEXT    NOT NULL,
      remote_account_id TEXT    NOT NULL,
      access_token      TEXT,
      profile_id        INTEGER,
      display_order     INTEGER NOT NULL DEFAULT 0,
      is_active         INTEGER NOT NULL DEFAULT 1,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL,
      UNIQUE(server_id, remote_account_id),
      FOREIGN KEY (server_id)  REFERENCES servers(id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    );
  `)

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_local_accounts_active ON local_accounts(is_active);`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_local_accounts_server ON local_accounts(server_id);`,
  )
}
