import type { SchemaDbHandle } from '../../worker/workerSchema'
import type { Migration } from '../types'

/**
 * v2.0.1 マイグレーション — muted_accounts / blocked_instances テーブル追加
 *
 * v2.0.0 で未作成だった muted_accounts と blocked_instances テーブルを追加する。
 * 既存データへの影響なし（新規テーブルの追加のみ）。
 */
export const v2_0_1_migration: Migration = {
  description:
    'Add muted_accounts and blocked_instances tables for mute/block filtering',

  up(handle: SchemaDbHandle) {
    const { db } = handle

    db.exec(`
      CREATE TABLE IF NOT EXISTS muted_accounts (
        server_id    INTEGER NOT NULL,
        account_acct TEXT    NOT NULL,
        muted_at     INTEGER NOT NULL,
        PRIMARY KEY (server_id, account_acct),
        FOREIGN KEY (server_id) REFERENCES servers(id)
      );
    `)

    db.exec(`
      CREATE TABLE IF NOT EXISTS blocked_instances (
        instance_domain TEXT PRIMARY KEY NOT NULL,
        blocked_at      INTEGER NOT NULL
      );
    `)
  },

  validate(handle: SchemaDbHandle): boolean {
    const { db } = handle

    for (const table of ['muted_accounts', 'blocked_instances']) {
      const rows = db.exec(
        `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${table}';`,
        { returnValue: 'resultRows' },
      ) as number[][]
      if (rows[0][0] === 0) {
        console.error(`Validation failed: table '${table}' not found`)
        return false
      }
    }

    return true
  },

  version: { major: 2, minor: 0, patch: 1 },
}
