import { createNotificationTables } from '../../schema/tables/notifications'
import type { Migration } from '../types'

export const v2_0_9_migration: Migration = {
  description: 'Preserve notifications and add nullable server read state',
  up({ db }) {
    db.exec(
      'ALTER TABLE local_accounts ADD COLUMN notification_last_read_id TEXT;',
    )
    db.exec(
      'ALTER TABLE notifications RENAME TO notifications_before_read_state;',
    )
    createNotificationTables(db)
    db.exec(`INSERT INTO notifications (
      id, local_account_id, local_id, notification_type_id, created_at_ms,
      actor_profile_id, related_post_id, reaction_name, reaction_url, is_read
    ) SELECT id, local_account_id, local_id, notification_type_id, created_at_ms,
      actor_profile_id, related_post_id, reaction_name, reaction_url, NULL
      FROM notifications_before_read_state;`)
    db.exec('DROP TABLE notifications_before_read_state;')
    // Index names belonged to the old table until it was dropped.
    createNotificationTables(db)
  },
  version: { major: 2, minor: 0, patch: 9 },
}
