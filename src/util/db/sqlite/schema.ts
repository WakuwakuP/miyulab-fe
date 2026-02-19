/**
 * SQLite スキーマ定義 & マイグレーション
 *
 * v2 スキーマでは、statuses / notifications テーブルに正規化カラムを追加し、
 * json_extract() に依存していたフィルタ処理をインデックス付きカラムで実行可能にする。
 *
 * v3 スキーマでは、ActivityPub URI ベースの跨サーバー重複排除を導入する。
 * - statuses テーブルに uri / reblog_of_uri カラムを追加
 * - statuses_backends テーブルを新設（投稿 × バックエンドの多対多）
 * - 同一 URI の投稿は1行に集約し、複数バックエンドとの関連は statuses_backends で管理
 *
 * 新規テーブル:
 * - statuses_mentions: 投稿内のメンション先ユーザー（多対多）
 * - statuses_backends: 投稿 × バックエンド（多対多） ← v3 で追加
 * - muted_accounts: ミュートしたアカウント
 * - blocked_instances: ブロックしたインスタンス
 */

import type { DbHandle } from './initSqlite'

/** 現在のスキーマバージョン */
const SCHEMA_VERSION = 3

/**
 * スキーマの初期化・マイグレーション
 *
 * user_version PRAGMA を用いてバージョン管理する。
 */
export async function ensureSchema(handle: DbHandle): Promise<void> {
  const currentVersion = (
    (await handle.exec('PRAGMA user_version;', {
      returnValue: 'resultRows',
    })) as number[][]
  )[0][0]

  if (currentVersion >= SCHEMA_VERSION) return

  await handle.exec('BEGIN;')
  try {
    if (currentVersion < 1) {
      // フレッシュインストール: v3 スキーマを直接作成
      await createSchemaV3(handle)
    } else if (currentVersion < 2) {
      // v1 → v2 → v3 マイグレーション
      await migrateV1toV2(handle)
      await migrateV2toV3(handle)
    } else if (currentVersion < 3) {
      // v2 → v3 マイグレーション
      await migrateV2toV3(handle)
    }

    await handle.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`)
    await handle.exec('COMMIT;')
  } catch (e) {
    await handle.exec('ROLLBACK;')
    throw e
  }
}

// ================================================================
// v3 フルスキーマ作成（フレッシュインストール用）
// ================================================================

/**
 * v3 スキーマのフル作成（フレッシュインストール用）
 *
 * v2 の正規化カラムに加え、uri / reblog_of_uri カラムと
 * statuses_backends テーブルを含む。
 */
async function createSchemaV3(handle: DbHandle): Promise<void> {
  // ============================================
  // statuses テーブル（正規化カラム + uri 含む）
  // ============================================
  await handle.exec(`
    CREATE TABLE IF NOT EXISTS statuses (
      compositeKey      TEXT PRIMARY KEY,
      backendUrl        TEXT NOT NULL,
      created_at_ms     INTEGER NOT NULL,
      storedAt          INTEGER NOT NULL,
      uri               TEXT NOT NULL DEFAULT '',
      account_acct      TEXT NOT NULL DEFAULT '',
      account_id        TEXT NOT NULL DEFAULT '',
      visibility        TEXT NOT NULL DEFAULT 'public',
      language          TEXT,
      has_media         INTEGER NOT NULL DEFAULT 0,
      media_count       INTEGER NOT NULL DEFAULT 0,
      is_reblog         INTEGER NOT NULL DEFAULT 0,
      reblog_of_id      TEXT,
      reblog_of_uri     TEXT,
      is_sensitive      INTEGER NOT NULL DEFAULT 0,
      has_spoiler       INTEGER NOT NULL DEFAULT 0,
      in_reply_to_id    TEXT,
      favourites_count  INTEGER NOT NULL DEFAULT 0,
      reblogs_count     INTEGER NOT NULL DEFAULT 0,
      replies_count     INTEGER NOT NULL DEFAULT 0,
      json              TEXT NOT NULL
    );
  `)

  // statuses インデックス（既存 + v2 + v3）
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_backendUrl ON statuses(backendUrl);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_backend_created ON statuses(backendUrl, created_at_ms DESC);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_storedAt ON statuses(storedAt);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_account_acct ON statuses(account_acct);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_reblog_of_id ON statuses(reblog_of_id);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_media_filter ON statuses(backendUrl, has_media, created_at_ms DESC);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_visibility_filter ON statuses(backendUrl, visibility, created_at_ms DESC);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_language_filter ON statuses(backendUrl, language, created_at_ms DESC);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_reblog_filter ON statuses(backendUrl, is_reblog, created_at_ms DESC);',
  )
  // v3 インデックス
  await handle.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_statuses_uri ON statuses(uri) WHERE uri != '';",
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_reblog_of_uri ON statuses(reblog_of_uri);',
  )

  // ============================================
  // statuses_timeline_types (多対多)
  // ============================================
  await handle.exec(`
    CREATE TABLE IF NOT EXISTS statuses_timeline_types (
      compositeKey  TEXT NOT NULL,
      timelineType  TEXT NOT NULL,
      PRIMARY KEY (compositeKey, timelineType),
      FOREIGN KEY (compositeKey) REFERENCES statuses(compositeKey) ON DELETE CASCADE
    );
  `)
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_stt_type ON statuses_timeline_types(timelineType);',
  )

  // ============================================
  // statuses_belonging_tags (多対多)
  // ============================================
  await handle.exec(`
    CREATE TABLE IF NOT EXISTS statuses_belonging_tags (
      compositeKey  TEXT NOT NULL,
      tag           TEXT NOT NULL,
      PRIMARY KEY (compositeKey, tag),
      FOREIGN KEY (compositeKey) REFERENCES statuses(compositeKey) ON DELETE CASCADE
    );
  `)
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_sbt_tag ON statuses_belonging_tags(tag);',
  )

  // ============================================
  // statuses_mentions (v2: メンション多対多)
  // ============================================
  await handle.exec(`
    CREATE TABLE IF NOT EXISTS statuses_mentions (
      compositeKey  TEXT NOT NULL,
      acct          TEXT NOT NULL,
      PRIMARY KEY (compositeKey, acct),
      FOREIGN KEY (compositeKey) REFERENCES statuses(compositeKey) ON DELETE CASCADE
    );
  `)
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_sm_acct ON statuses_mentions(acct);',
  )

  // ============================================
  // statuses_backends (v3: 投稿 × バックエンドの多対多)
  // ============================================
  await handle.exec(`
    CREATE TABLE IF NOT EXISTS statuses_backends (
      compositeKey  TEXT NOT NULL,
      backendUrl    TEXT NOT NULL,
      local_id      TEXT NOT NULL,
      PRIMARY KEY (backendUrl, local_id),
      FOREIGN KEY (compositeKey) REFERENCES statuses(compositeKey) ON DELETE CASCADE
    );
  `)
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_sb_compositeKey ON statuses_backends(compositeKey);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_sb_backendUrl ON statuses_backends(backendUrl);',
  )

  // ============================================
  // muted_accounts (v2)
  // ============================================
  await handle.exec(`
    CREATE TABLE IF NOT EXISTS muted_accounts (
      backendUrl    TEXT NOT NULL,
      account_acct  TEXT NOT NULL,
      muted_at      INTEGER NOT NULL,
      PRIMARY KEY (backendUrl, account_acct)
    );
  `)

  // ============================================
  // blocked_instances (v2)
  // ============================================
  await handle.exec(`
    CREATE TABLE IF NOT EXISTS blocked_instances (
      instance_domain TEXT PRIMARY KEY,
      blocked_at      INTEGER NOT NULL
    );
  `)

  // ============================================
  // notifications テーブル（正規化カラム含む）
  // ============================================
  await handle.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      compositeKey      TEXT PRIMARY KEY,
      backendUrl        TEXT NOT NULL,
      created_at_ms     INTEGER NOT NULL,
      storedAt          INTEGER NOT NULL,
      notification_type TEXT NOT NULL DEFAULT '',
      status_id         TEXT,
      account_acct      TEXT NOT NULL DEFAULT '',
      json              TEXT NOT NULL
    );
  `)
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_backendUrl ON notifications(backendUrl);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_backend_created ON notifications(backendUrl, created_at_ms DESC);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_storedAt ON notifications(storedAt);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(notification_type);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_status_id ON notifications(backendUrl, status_id);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_account_acct ON notifications(account_acct);',
  )
}

// ================================================================
// v1 → v2 マイグレーション
// ================================================================

/**
 * v1 → v2 マイグレーション
 *
 * ALTER TABLE ADD COLUMN で正規化カラムを追加し、
 * 既存データを json_extract() でバックフィルする。
 */
async function migrateV1toV2(handle: DbHandle): Promise<void> {
  // ============================================
  // Step 1: statuses テーブルへのカラム追加
  // ============================================
  const statusColumns = [
    "account_acct TEXT NOT NULL DEFAULT ''",
    "account_id TEXT NOT NULL DEFAULT ''",
    "visibility TEXT NOT NULL DEFAULT 'public'",
    'language TEXT',
    'has_media INTEGER NOT NULL DEFAULT 0',
    'media_count INTEGER NOT NULL DEFAULT 0',
    'is_reblog INTEGER NOT NULL DEFAULT 0',
    'reblog_of_id TEXT',
    'is_sensitive INTEGER NOT NULL DEFAULT 0',
    'has_spoiler INTEGER NOT NULL DEFAULT 0',
    'in_reply_to_id TEXT',
    'favourites_count INTEGER NOT NULL DEFAULT 0',
    'reblogs_count INTEGER NOT NULL DEFAULT 0',
    'replies_count INTEGER NOT NULL DEFAULT 0',
  ]
  for (const col of statusColumns) {
    await handle.exec(`ALTER TABLE statuses ADD COLUMN ${col};`)
  }

  // ============================================
  // Step 2: notifications テーブルへのカラム追加
  // ============================================
  const notifColumns = [
    "notification_type TEXT NOT NULL DEFAULT ''",
    'status_id TEXT',
    "account_acct TEXT NOT NULL DEFAULT ''",
  ]
  for (const col of notifColumns) {
    await handle.exec(`ALTER TABLE notifications ADD COLUMN ${col};`)
  }

  // ============================================
  // Step 3: 新規テーブルの作成
  // ============================================
  await handle.exec(`
    CREATE TABLE IF NOT EXISTS statuses_mentions (
      compositeKey  TEXT NOT NULL,
      acct          TEXT NOT NULL,
      PRIMARY KEY (compositeKey, acct),
      FOREIGN KEY (compositeKey) REFERENCES statuses(compositeKey) ON DELETE CASCADE
    );
  `)

  await handle.exec(`
    CREATE TABLE IF NOT EXISTS muted_accounts (
      backendUrl    TEXT NOT NULL,
      account_acct  TEXT NOT NULL,
      muted_at      INTEGER NOT NULL,
      PRIMARY KEY (backendUrl, account_acct)
    );
  `)

  await handle.exec(`
    CREATE TABLE IF NOT EXISTS blocked_instances (
      instance_domain TEXT PRIMARY KEY,
      blocked_at      INTEGER NOT NULL
    );
  `)

  // ============================================
  // Step 4: 新規インデックスの作成
  // ============================================
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_account_acct ON statuses(account_acct);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_reblog_of_id ON statuses(reblog_of_id);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_media_filter ON statuses(backendUrl, has_media, created_at_ms DESC);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_visibility_filter ON statuses(backendUrl, visibility, created_at_ms DESC);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_language_filter ON statuses(backendUrl, language, created_at_ms DESC);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_reblog_filter ON statuses(backendUrl, is_reblog, created_at_ms DESC);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_sm_acct ON statuses_mentions(acct);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(notification_type);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_status_id ON notifications(backendUrl, status_id);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_account_acct ON notifications(account_acct);',
  )

  // ============================================
  // Step 5: バックフィル
  // ============================================
  await backfillStatusesV2(handle)
  await backfillNotificationsV2(handle)
  await backfillMentionsV2(handle)
}

// ================================================================
// v2 → v3 マイグレーション
// ================================================================

/**
 * v2 → v3 マイグレーション
 *
 * ActivityPub URI ベースの跨サーバー重複排除を導入する。
 *
 * 1. statuses テーブルに uri / reblog_of_uri カラムを追加
 * 2. statuses_backends テーブルを新設
 * 3. 既存データのバックフィル（uri, reblog_of_uri, statuses_backends）
 * 4. 同一 URI の重複行を1行に集約（デデュプリケーション）
 */
async function migrateV2toV3(handle: DbHandle): Promise<void> {
  // ============================================
  // Step 1: statuses テーブルへのカラム追加
  // ============================================
  await handle.exec(
    "ALTER TABLE statuses ADD COLUMN uri TEXT NOT NULL DEFAULT '';",
  )
  await handle.exec('ALTER TABLE statuses ADD COLUMN reblog_of_uri TEXT;')

  // ============================================
  // Step 2: statuses_backends テーブルの作成
  // ============================================
  await handle.exec(`
    CREATE TABLE IF NOT EXISTS statuses_backends (
      compositeKey  TEXT NOT NULL,
      backendUrl    TEXT NOT NULL,
      local_id      TEXT NOT NULL,
      PRIMARY KEY (backendUrl, local_id),
      FOREIGN KEY (compositeKey) REFERENCES statuses(compositeKey) ON DELETE CASCADE
    );
  `)

  // ============================================
  // Step 3: 非UNIQUEインデックスの作成
  // ============================================
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_reblog_of_uri ON statuses(reblog_of_uri);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_sb_compositeKey ON statuses_backends(compositeKey);',
  )
  await handle.exec(
    'CREATE INDEX IF NOT EXISTS idx_sb_backendUrl ON statuses_backends(backendUrl);',
  )

  // ============================================
  // Step 4: uri / reblog_of_uri のバックフィル
  // ============================================
  await backfillStatusesV3(handle)

  // ============================================
  // Step 5: statuses_backends のバックフィル
  //
  // compositeKey は "backendUrl:statusId" 形式。
  // backendUrl の長さ + 1（':' の分）以降が local_id。
  // ============================================
  await handle.exec(`
    INSERT OR IGNORE INTO statuses_backends (compositeKey, backendUrl, local_id)
    SELECT
      compositeKey,
      backendUrl,
      SUBSTR(compositeKey, LENGTH(backendUrl) + 2) AS local_id
    FROM statuses;
  `)

  // ============================================
  // Step 6: 同一 URI の重複排除（デデュプリケーション）
  // ============================================
  await deduplicateByUri(handle)

  // ============================================
  // Step 7: UNIQUEインデックスの作成（重複排除後）
  // ============================================
  await handle.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_statuses_uri ON statuses(uri) WHERE uri != '';",
  )
}

// ================================================================
// バックフィル関数
// ================================================================

/**
 * statuses テーブルの v2 バックフィル
 *
 * json カラムから json_extract で値を抽出して正規化カラムに書き込む。
 */
async function backfillStatusesV2(handle: DbHandle): Promise<void> {
  await handle.exec(`
    UPDATE statuses SET
      account_acct     = COALESCE(json_extract(json, '$.account.acct'), ''),
      account_id       = COALESCE(json_extract(json, '$.account.id'), ''),
      visibility       = COALESCE(json_extract(json, '$.visibility'), 'public'),
      language         = json_extract(json, '$.language'),
      has_media        = CASE
                           WHEN json_array_length(json_extract(json, '$.media_attachments')) > 0 THEN 1
                           ELSE 0
                         END,
      media_count      = COALESCE(json_array_length(json_extract(json, '$.media_attachments')), 0),
      is_reblog        = CASE
                           WHEN json_extract(json, '$.reblog') IS NOT NULL THEN 1
                           ELSE 0
                         END,
      reblog_of_id     = json_extract(json, '$.reblog.id'),
      is_sensitive     = CASE
                           WHEN json_extract(json, '$.sensitive') = 1 THEN 1
                           ELSE 0
                         END,
      has_spoiler      = CASE
                           WHEN COALESCE(json_extract(json, '$.spoiler_text'), '') != '' THEN 1
                           ELSE 0
                         END,
      in_reply_to_id   = json_extract(json, '$.in_reply_to_id'),
      favourites_count = COALESCE(json_extract(json, '$.favourites_count'), 0),
      reblogs_count    = COALESCE(json_extract(json, '$.reblogs_count'), 0),
      replies_count    = COALESCE(json_extract(json, '$.replies_count'), 0)
    WHERE account_acct = '';
  `)
}

/**
 * notifications テーブルの v2 バックフィル
 */
async function backfillNotificationsV2(handle: DbHandle): Promise<void> {
  await handle.exec(`
    UPDATE notifications SET
      notification_type = COALESCE(json_extract(json, '$.type'), ''),
      status_id         = json_extract(json, '$.status.id'),
      account_acct      = COALESCE(json_extract(json, '$.account.acct'), '')
    WHERE notification_type = '';
  `)
}

/**
 * statuses_mentions テーブルの v2 バックフィル
 */
async function backfillMentionsV2(handle: DbHandle): Promise<void> {
  await handle.exec(`
    INSERT OR IGNORE INTO statuses_mentions (compositeKey, acct)
    SELECT
      s.compositeKey,
      json_extract(m.value, '$.acct')
    FROM statuses s,
         json_each(json_extract(s.json, '$.mentions')) m
    WHERE json_extract(m.value, '$.acct') IS NOT NULL;
  `)
}

/**
 * statuses テーブルの v3 バックフィル
 *
 * json カラムから uri / reblog_of_uri を抽出して正規化カラムに書き込む。
 */
async function backfillStatusesV3(handle: DbHandle): Promise<void> {
  // uri のバックフィル
  await handle.exec(`
    UPDATE statuses SET
      uri = COALESCE(json_extract(json, '$.uri'), '')
    WHERE uri = '';
  `)

  // reblog_of_uri のバックフィル
  await handle.exec(`
    UPDATE statuses SET
      reblog_of_uri = json_extract(json, '$.reblog.uri')
    WHERE is_reblog = 1 AND reblog_of_uri IS NULL;
  `)
}

// ================================================================
// 重複排除（デデュプリケーション）
// ================================================================

/**
 * 同一 URI を持つ重複行を1行に集約する
 *
 * 各グループで storedAt が最新の行を "勝者" として残し、
 * "敗者" の関連データ（timeline_types, belonging_tags, mentions, backends）
 * を勝者にマージしてから敗者を削除する。
 *
 * CASCADE 削除により、敗者の compositeKey を参照する
 * ジャンクションテーブルの行も自動的に削除される。
 * ただしマージは CASCADE 前に行うため、データは失われない。
 */
async function deduplicateByUri(handle: DbHandle): Promise<void> {
  // 重複 URI を検出（空文字列は除外）
  const dupes = (await handle.exec(
    `SELECT uri FROM statuses
     WHERE uri != ''
     GROUP BY uri
     HAVING COUNT(*) > 1;`,
    { returnValue: 'resultRows' },
  )) as string[][]

  if (dupes.length === 0) return

  for (const [uri] of dupes) {
    // storedAt 降順で全行取得（最新が先頭 = 勝者）
    const rows = (await handle.exec(
      `SELECT compositeKey FROM statuses
       WHERE uri = ?
       ORDER BY storedAt DESC;`,
      { bind: [uri], returnValue: 'resultRows' },
    )) as string[][]

    if (rows.length < 2) continue

    const winnerKey = rows[0][0]
    const loserKeys = rows.slice(1).map((r) => r[0])

    for (const loserKey of loserKeys) {
      // タイムライン種別をマージ
      await handle.exec(
        `INSERT OR IGNORE INTO statuses_timeline_types (compositeKey, timelineType)
         SELECT ?, timelineType FROM statuses_timeline_types WHERE compositeKey = ?;`,
        { bind: [winnerKey, loserKey] },
      )

      // タグをマージ
      await handle.exec(
        `INSERT OR IGNORE INTO statuses_belonging_tags (compositeKey, tag)
         SELECT ?, tag FROM statuses_belonging_tags WHERE compositeKey = ?;`,
        { bind: [winnerKey, loserKey] },
      )

      // メンションをマージ
      await handle.exec(
        `INSERT OR IGNORE INTO statuses_mentions (compositeKey, acct)
         SELECT ?, acct FROM statuses_mentions WHERE compositeKey = ?;`,
        { bind: [winnerKey, loserKey] },
      )

      // バックエンド情報をマージ（compositeKey を勝者に付け替え）
      // PK は (backendUrl, local_id) なので compositeKey の変更は一意性に影響しない
      await handle.exec(
        `UPDATE OR IGNORE statuses_backends
         SET compositeKey = ?
         WHERE compositeKey = ?;`,
        { bind: [winnerKey, loserKey] },
      )

      // 敗者行を削除（CASCADE で関連テーブルの残留行も削除）
      await handle.exec('DELETE FROM statuses WHERE compositeKey = ?;', {
        bind: [loserKey],
      })
    }
  }
}
