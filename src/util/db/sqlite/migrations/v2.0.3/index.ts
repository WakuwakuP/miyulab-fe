import type { SchemaDbHandle } from '../../worker/workerSchema'
import type { Migration } from '../types'

/**
 * v2.0.3 マイグレーション — profiles.canonical_acct カラム追加
 *
 * 同一 Fediverse ユーザーが異なる server 経由で別々の profile_id を持つ問題を解決するため、
 * `canonical_acct` (= acct@host の正規化形式) カラムを追加する。
 * 既存行は acct + servers.host から算出して一括更新する。
 */
export const v2_0_3_migration: Migration = {
  description:
    'Add canonical_acct column to profiles for cross-server identity resolution',

  up(handle: SchemaDbHandle) {
    const { db } = handle

    // カラムが未追加の場合のみ ALTER TABLE
    const cols = db.exec('PRAGMA table_info(profiles);', {
      returnValue: 'resultRows',
    }) as unknown[][]
    const hasColumn = cols.some(
      (row) => (row as [number, string])[1] === 'canonical_acct',
    )
    if (!hasColumn) {
      db.exec(
        "ALTER TABLE profiles ADD COLUMN canonical_acct TEXT NOT NULL DEFAULT '';",
      )
    }

    // 既存行を一括更新: acct に '@' が含まれればそのまま、含まれなければ acct@host
    db.exec(`
      UPDATE profiles
      SET canonical_acct = CASE
        WHEN acct LIKE '%@%' THEN acct
        ELSE acct || '@' || (SELECT host FROM servers WHERE servers.id = profiles.server_id)
      END
      WHERE canonical_acct = '';
    `)

    // インデックス追加
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_profiles_canonical_acct ON profiles(canonical_acct);',
    )
  },

  validate(handle: SchemaDbHandle): boolean {
    const { db } = handle

    // canonical_acct カラムが存在するか
    const cols = db.exec('PRAGMA table_info(profiles);', {
      returnValue: 'resultRows',
    }) as unknown[][]
    const hasColumn = cols.some(
      (row) => (row as [number, string])[1] === 'canonical_acct',
    )
    if (!hasColumn) {
      console.error('Validation failed: canonical_acct column not found')
      return false
    }

    // 空のcanonical_acctが残っていないか (profiles が存在する場合)
    const emptyRows = db.exec(
      "SELECT COUNT(*) FROM profiles WHERE canonical_acct = '';",
      { returnValue: 'resultRows' },
    ) as number[][]
    if (emptyRows[0][0] > 0) {
      console.error(
        `Validation failed: ${emptyRows[0][0]} profiles still have empty canonical_acct`,
      )
      return false
    }

    return true
  },

  version: { major: 2, minor: 0, patch: 3 },
}
