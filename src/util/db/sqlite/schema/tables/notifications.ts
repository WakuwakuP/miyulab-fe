import type { DbExec } from '../types'

export function createNotificationTables(db: DbExec): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      local_account_id     INTEGER NOT NULL,
      local_id             TEXT    NOT NULL,
      notification_type_id INTEGER NOT NULL,
      created_at_ms        INTEGER NOT NULL,
      actor_profile_id     INTEGER,
      related_post_id      INTEGER,
      reaction_name        TEXT,
      reaction_url         TEXT,
      is_read              INTEGER NOT NULL DEFAULT 0,
      UNIQUE(local_account_id, local_id),
      FOREIGN KEY (local_account_id)     REFERENCES local_accounts(id)   ON DELETE CASCADE,
      FOREIGN KEY (notification_type_id) REFERENCES notification_types(id),
      FOREIGN KEY (actor_profile_id)     REFERENCES profiles(id)         ON DELETE SET NULL,
      FOREIGN KEY (related_post_id)      REFERENCES posts(id)            ON DELETE SET NULL
    );
  `)

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_notifications_account_created ON notifications(local_account_id, created_at_ms DESC);`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(local_account_id, notification_type_id);`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(local_account_id, is_read) WHERE is_read = 0;`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_notifications_actor ON notifications(actor_profile_id) WHERE actor_profile_id IS NOT NULL;`,
  )
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_notifications_post ON notifications(related_post_id) WHERE related_post_id IS NOT NULL;`,
  )
}
