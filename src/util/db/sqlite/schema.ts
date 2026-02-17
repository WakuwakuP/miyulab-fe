/**
 * SQLite スキーマ定義 & マイグレーション
 *
 * IndexedDB (Dexie) と同等のスキーマを SQL で再現する。
 * statuses / notifications / statuses_timeline_types / statuses_belonging_tags
 * の4テーブル構成で、多対多のリレーションを正規化する。
 */

import type { DbHandle } from './initSqlite'

/** 現在のスキーマバージョン */
const SCHEMA_VERSION = 1

/**
 * スキーマの初期化・マイグレーション
 *
 * user_version PRAGMA を用いてバージョン管理する。
 */
export function ensureSchema(handle: DbHandle): void {
  const { db } = handle

  const currentVersion = (
    db.exec('PRAGMA user_version;', { returnValue: 'resultRows' }) as number[][]
  )[0][0]

  if (currentVersion >= SCHEMA_VERSION) return

  db.exec('BEGIN;')
  try {
    // ============================================
    // statuses テーブル
    // ============================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS statuses (
        compositeKey TEXT PRIMARY KEY,
        backendUrl   TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        storedAt     INTEGER NOT NULL,
        json         TEXT NOT NULL
      );
    `)

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_statuses_backendUrl
        ON statuses(backendUrl);
    `)

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_statuses_backend_created
        ON statuses(backendUrl, created_at_ms DESC);
    `)

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_statuses_storedAt
        ON statuses(storedAt);
    `)

    // ============================================
    // statuses_timeline_types (多対多)
    // ============================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS statuses_timeline_types (
        compositeKey  TEXT NOT NULL,
        timelineType  TEXT NOT NULL,
        PRIMARY KEY (compositeKey, timelineType),
        FOREIGN KEY (compositeKey) REFERENCES statuses(compositeKey) ON DELETE CASCADE
      );
    `)

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_stt_type
        ON statuses_timeline_types(timelineType);
    `)

    // ============================================
    // statuses_belonging_tags (多対多)
    // ============================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS statuses_belonging_tags (
        compositeKey  TEXT NOT NULL,
        tag           TEXT NOT NULL,
        PRIMARY KEY (compositeKey, tag),
        FOREIGN KEY (compositeKey) REFERENCES statuses(compositeKey) ON DELETE CASCADE
      );
    `)

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sbt_tag
        ON statuses_belonging_tags(tag);
    `)

    // ============================================
    // notifications テーブル
    // ============================================
    db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        compositeKey  TEXT PRIMARY KEY,
        backendUrl    TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        storedAt      INTEGER NOT NULL,
        json          TEXT NOT NULL
      );
    `)

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_notifications_backendUrl
        ON notifications(backendUrl);
    `)

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_notifications_backend_created
        ON notifications(backendUrl, created_at_ms DESC);
    `)

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_notifications_storedAt
        ON notifications(storedAt);
    `)

    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`)
    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }
}
