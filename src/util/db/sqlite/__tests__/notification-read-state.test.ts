import { DatabaseSync } from 'node:sqlite'
import type { Entity } from 'megalodon'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localAccountIdCache } from '../helpers/cache'
import { v2_0_9_migration } from '../migrations/v2.0.9'
import { createFreshSchema } from '../schema'
import { handleUpdateNotificationReadState } from '../worker/handlers/notificationReadHandlers'
import type { DbExec } from '../worker/handlers/types'
import { upsertNotification } from '../worker/workerNotificationStore'

let native: DatabaseSync
let db: DbExec
beforeEach(() => {
  native = new DatabaseSync(':memory:')
  db = {
    exec(sql, options) {
      if (options?.returnValue === 'resultRows')
        return native
          .prepare(sql)
          .all(...(options.bind ?? []))
          .map((row) => Object.values(row))
      if (options?.bind) return native.prepare(sql).run(...options.bind)
      return native.exec(sql)
    },
  }
  localAccountIdCache.clear()
  createFreshSchema({ db })
  native.exec(`PRAGMA foreign_keys = ON;
    INSERT INTO servers(id, host) VALUES (1, 'one.test'), (2, 'two.test');
    INSERT INTO local_accounts(id, server_id, backend_url, backend_type, acct, remote_account_id, created_at, updated_at)
      VALUES (1, 1, 'https://one.test', 'mastodon', 'self@one.test', 'self', 0, 0), (2, 2, 'https://two.test', 'mastodon', 'self@two.test', 'self', 0, 0);`)
})
afterEach(() => {
  localAccountIdCache.clear()
  native.close()
})

function insert(id: string, account = 1, read: number | null = null) {
  native
    .prepare(
      'INSERT INTO notifications(local_account_id, local_id, notification_type_id, created_at_ms, is_read) VALUES (?, ?, 1, 10, ?);',
    )
    .run(account, id, read)
}
const account = {
  backendUrl: 'https://one.test',
  localAccountId: 1,
  remoteAccountId: 'self',
}
function states() {
  return native
    .prepare(
      'SELECT local_account_id, local_id, is_read FROM notifications ORDER BY id',
    )
    .all()
    .map((row) => Object.values(row))
}

describe('notification read persistence (real SQLite)', () => {
  it('rolls back the boundary if a row update fails', () => {
    insert('1')
    native.exec(
      "CREATE TRIGGER reject_read BEFORE UPDATE OF is_read ON notifications BEGIN SELECT RAISE(ABORT, 'read failed'); END;",
    )
    expect(() =>
      handleUpdateNotificationReadState(db, { ...account, boundary: '1' }),
    ).toThrow('read failed')
    expect(states()).toEqual([[1, '1', null]])
    expect(
      native
        .prepare(
          'SELECT notification_last_read_id FROM local_accounts WHERE id=1',
        )
        .get()?.notification_last_read_id,
    ).toBeNull()
  })
  it('emits no changed tables for an unchanged state and rejects a stale local account', () => {
    insert('1')
    handleUpdateNotificationReadState(db, { ...account, boundary: '1' })
    expect(
      handleUpdateNotificationReadState(db, { ...account, boundary: '1' })
        .changedTables,
    ).toEqual([])
    expect(() =>
      handleUpdateNotificationReadState(db, {
        ...account,
        boundary: '2',
        localAccountId: 2,
      }),
    ).toThrow('変更されました')
    expect(states()).toEqual([[1, '1', 1]])
  })
  it('scopes a cutoff to one account, handles more than 80 rows and preserves newer rows', () => {
    for (let id = 1; id <= 100; id++) insert(String(id))
    insert('101')
    insert('1', 2)
    handleUpdateNotificationReadState(db, { ...account, boundary: '100' })
    expect(
      states()
        .slice(0, 100)
        .every((row) => row[2] === 1),
    ).toBe(true)
    expect(states().slice(100)).toEqual([
      [1, '101', 0],
      [2, '1', null],
    ])
  })
  it('keeps read rows read after stale metadata and prevents boundary regression', () => {
    insert('1', 1, 1)
    insert('2', 1, 0)
    handleUpdateNotificationReadState(db, { ...account, boundary: '2' })
    handleUpdateNotificationReadState(db, {
      ...account,
      boundary: '1',
      updates: [{ id: '2', isRead: false }],
    })
    expect(states()).toEqual([
      [1, '1', 1],
      [1, '2', 1],
    ])
    expect(
      native
        .prepare(
          'SELECT notification_last_read_id FROM local_accounts WHERE id=1',
        )
        .get()?.notification_last_read_id,
    ).toBe('2')
  })
  it('updates only snapshot IDs for boundary-less backends', () => {
    insert('snapshot')
    insert('new-arrival')
    handleUpdateNotificationReadState(db, {
      ...account,
      updates: [{ id: 'snapshot', isRead: true }],
    })
    expect(states()).toEqual([
      [1, 'snapshot', 1],
      [1, 'new-arrival', null],
    ])
  })
  it('rejects an identity mismatch without changing any rows', () => {
    insert('1')
    expect(() =>
      handleUpdateNotificationReadState(db, {
        ...account,
        boundary: '1',
        remoteAccountId: 'other',
      }),
    ).toThrow('一致しません')
    expect(states()).toEqual([[1, '1', null]])
  })
  it('assigns stored cutoffs to late fetched notifications and never regresses known read on UPSERT', () => {
    handleUpdateNotificationReadState(db, { ...account, boundary: '20' })
    const notification = {
      created_at: '2026-10-09T00:00:00Z',
      id: '10',
      type: 'follow',
    } as Entity.Notification & { isRead?: boolean | null }
    upsertNotification(db, notification, account.backendUrl)
    upsertNotification(
      db,
      { ...notification, isRead: false },
      account.backendUrl,
    )
    expect(states()).toEqual([[1, '10', 1]])
  })
  it('retains notification identities, body, related references and indexes during migration', () => {
    const ddl = native
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='notifications'",
      )
      .get()?.sql as string
    native.exec(
      'DROP TABLE notifications; ALTER TABLE local_accounts DROP COLUMN notification_last_read_id;',
    )
    native.exec(
      ddl.replace(
        /is_read\s+INTEGER DEFAULT NULL CHECK \([^\n]+\),/,
        'is_read INTEGER NOT NULL DEFAULT 0,',
      ),
    )
    insert('previous-unread', 1, 0)
    insert('previous-read', 1, 1)
    native.exec(
      "UPDATE notifications SET reaction_name=':wave:', reaction_url='https://one.test/wave.png' WHERE id=2;",
    )
    const before = native
      .prepare(
        'SELECT id, local_account_id, local_id, reaction_name, reaction_url FROM notifications',
      )
      .all()
    v2_0_9_migration.up({ db })
    expect(
      native
        .prepare(
          'SELECT id, local_account_id, local_id, reaction_name, reaction_url FROM notifications',
        )
        .all(),
    ).toEqual(before)
    expect(states()).toEqual([
      [1, 'previous-unread', null],
      [1, 'previous-read', null],
    ])
    expect(
      native
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='notifications'",
        )
        .all(),
    ).toHaveLength(7)
    expect(native.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
})
