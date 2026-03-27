import type { DbExec } from '../types'

export function createMetaTables(db: DbExec): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version     TEXT PRIMARY KEY,
      applied_at  INTEGER NOT NULL,
      description TEXT
    );
  `)
}
