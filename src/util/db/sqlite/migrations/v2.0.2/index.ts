import type { SchemaDbHandle } from '../../worker/workerSchema'
import type { Migration } from '../types'

/**
 * v2.0.2 マイグレーション — notification_types 'reaction' → 'emoji_reaction' リネーム
 *
 * Misskey/Pleroma の絵文字リアクション通知を 'emoji_reaction' に統一する。
 * 既存の 'reaction' (id=5) を 'emoji_reaction' にリネームし、
 * unknown (id=199) に分類されていた pleroma:emoji_reaction 通知も修正する。
 */
export const v2_0_2_migration: Migration = {
  description:
    "Rename notification_types 'reaction' to 'emoji_reaction' for Misskey/Pleroma unification",

  up(handle: SchemaDbHandle) {
    const { db } = handle

    // notification_types テーブルの name を更新
    db.exec(
      "UPDATE notification_types SET name = 'emoji_reaction' WHERE id = 5;",
    )
  },

  validate(handle: SchemaDbHandle): boolean {
    const { db } = handle

    const rows = db.exec('SELECT name FROM notification_types WHERE id = 5;', {
      returnValue: 'resultRows',
    }) as string[][]

    if (rows.length === 0 || rows[0][0] !== 'emoji_reaction') {
      console.error(
        "Validation failed: notification_types id=5 should be 'emoji_reaction'",
      )
      return false
    }

    return true
  },

  version: { major: 2, minor: 0, patch: 2 },
}
