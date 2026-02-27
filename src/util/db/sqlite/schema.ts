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
 * v5 スキーマでは、リブログ関係を専用テーブルで管理する。
 * - statuses_reblogs テーブルを新設（リブログ → 元投稿の関係）
 * - original_uri でリブログ元を追跡し、アクション伝播やカスタムクエリに利用
 *
 * v6 スキーマでは、タイムライン高速化のためのマテリアライズド・ビューを導入する。
 * - timeline_entries テーブルを新設（タイムライン用の実体化テーブル）
 * - tag_entries テーブルを新設（タグ用の実体化テーブル）
 * - TRIGGER で statuses / statuses_timeline_types / statuses_belonging_tags / statuses_backends と自動同期
 * - カスタムクエリ用インデックスを追加
 *
 * 新規テーブル:
 * - statuses_mentions: 投稿内のメンション先ユーザー（多対多）
 * - statuses_backends: 投稿 × バックエンド（多対多） ← v3 で追加
 * - statuses_reblogs: リブログ関係管理 ← v5 で追加
 * - timeline_entries: タイムライン用マテリアライズド・ビュー ← v6 で追加
 * - tag_entries: タグ用マテリアライズド・ビュー ← v6 で追加
 * - muted_accounts: ミュートしたアカウント
 * - blocked_instances: ブロックしたインスタンス
 */

import type { SchemaDbHandle as DbHandle } from './worker/workerSchema'

/** 現在のスキーマバージョン */
const SCHEMA_VERSION = 6

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
    if (currentVersion < 1) {
      // フレッシュインストール: v6 スキーマを直接作成
      createSchemaV6(handle)
    } else if (currentVersion < 2) {
      // v1 → v2 → v3 → v4 → v5 → v6 マイグレーション
      migrateV1toV2(handle)
      migrateV2toV3(handle)
      migrateV3toV4(handle)
      migrateV4toV5(handle)
      migrateV5toV6(handle)
    } else if (currentVersion < 3) {
      // v2 → v3 → v4 → v5 → v6 マイグレーション
      migrateV2toV3(handle)
      migrateV3toV4(handle)
      migrateV4toV5(handle)
      migrateV5toV6(handle)
    } else if (currentVersion < 4) {
      // v3 → v4 → v5 → v6 マイグレーション
      migrateV3toV4(handle)
      migrateV4toV5(handle)
      migrateV5toV6(handle)
    } else if (currentVersion < 5) {
      // v4 → v5 → v6 マイグレーション
      migrateV4toV5(handle)
      migrateV5toV6(handle)
    } else if (currentVersion < 6) {
      // v5 → v6 マイグレーション
      migrateV5toV6(handle)
    }

    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`)
    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }
}

// ================================================================
// v6 フルスキーマ作成（フレッシュインストール用）
// ================================================================

/**
 * v6 スキーマのフル作成（フレッシュインストール用）
 *
 * v5 に加え、マテリアライズド・ビュー（timeline_entries, tag_entries）と
 * 自動同期トリガー、カスタムクエリ用インデックスを含む。
 */
function createSchemaV6(handle: DbHandle): void {
  // v5 までのスキーマを作成
  createSchemaV5(handle)

  // ============================================
  // マテリアライズド・ビューテーブル + トリガー + インデックス (v6)
  // ============================================
  createMaterializedViewTables(handle)
  createMaterializedViewTriggers(handle)
  createCustomQueryIndexes(handle)
}

// ================================================================
// v5 スキーマ作成（v6 から内部呼び出し）
// ================================================================

/**
 * v5 スキーマのフル作成
 *
 * v4 に加え、リブログ関係を管理する statuses_reblogs テーブルを含む。
 */
function createSchemaV5(handle: DbHandle): void {
  // v4 までのスキーマを作成
  createSchemaV4(handle)

  // ============================================
  // statuses_reblogs (v5: リブログ関係管理)
  // ============================================
  createReblogsTable(handle)
}

// ================================================================
// v4 スキーマ作成（v5 から内部呼び出し）
// ================================================================

/**
 * v4 スキーマ作成
 *
 * v3 に加え、JOIN 最適化用のカバリングインデックスを含む。
 */
function createSchemaV4(handle: DbHandle): void {
  const { db } = handle

  // ============================================
  // statuses テーブル（正規化カラム + uri 含む）
  // ============================================
  db.exec(`
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
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_backendUrl ON statuses(backendUrl);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_backend_created ON statuses(backendUrl, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_storedAt ON statuses(storedAt);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_account_acct ON statuses(account_acct);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_reblog_of_id ON statuses(reblog_of_id);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_media_filter ON statuses(backendUrl, has_media, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_visibility_filter ON statuses(backendUrl, visibility, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_language_filter ON statuses(backendUrl, language, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_reblog_filter ON statuses(backendUrl, is_reblog, created_at_ms DESC);',
  )
  // v3 インデックス
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_statuses_uri ON statuses(uri) WHERE uri != '';",
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_reblog_of_uri ON statuses(reblog_of_uri);',
  )

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
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_stt_type ON statuses_timeline_types(timelineType);',
  )
  // v4: JOIN 最適化用カバリングインデックス（timelineType → compositeKey の逆順）
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_stt_type_key ON statuses_timeline_types(timelineType, compositeKey);',
  )

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
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_sbt_tag ON statuses_belonging_tags(tag);',
  )
  // v4: JOIN 最適化用カバリングインデックス（tag → compositeKey の逆順）
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_sbt_tag_key ON statuses_belonging_tags(tag, compositeKey);',
  )

  // ============================================
  // statuses_mentions (v2: メンション多対多)
  // ============================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS statuses_mentions (
      compositeKey  TEXT NOT NULL,
      acct          TEXT NOT NULL,
      PRIMARY KEY (compositeKey, acct),
      FOREIGN KEY (compositeKey) REFERENCES statuses(compositeKey) ON DELETE CASCADE
    );
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_sm_acct ON statuses_mentions(acct);')

  // ============================================
  // statuses_backends (v3: 投稿 × バックエンドの多対多)
  // ============================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS statuses_backends (
      compositeKey  TEXT NOT NULL,
      backendUrl    TEXT NOT NULL,
      local_id      TEXT NOT NULL,
      PRIMARY KEY (backendUrl, local_id),
      FOREIGN KEY (compositeKey) REFERENCES statuses(compositeKey) ON DELETE CASCADE
    );
  `)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_sb_compositeKey ON statuses_backends(compositeKey);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_sb_backendUrl ON statuses_backends(backendUrl);',
  )
  // v4: JOIN 最適化用カバリングインデックス（backendUrl → compositeKey）
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_sb_backend_key ON statuses_backends(backendUrl, compositeKey);',
  )

  // ============================================
  // muted_accounts (v2)
  // ============================================
  db.exec(`
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS blocked_instances (
      instance_domain TEXT PRIMARY KEY,
      blocked_at      INTEGER NOT NULL
    );
  `)

  // ============================================
  // notifications テーブル（正規化カラム含む）
  // ============================================
  db.exec(`
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
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_backendUrl ON notifications(backendUrl);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_backend_created ON notifications(backendUrl, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_storedAt ON notifications(storedAt);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(notification_type);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_status_id ON notifications(backendUrl, status_id);',
  )
  db.exec(
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
function migrateV1toV2(handle: DbHandle): void {
  const { db } = handle

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
    db.exec(`ALTER TABLE statuses ADD COLUMN ${col};`)
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
    db.exec(`ALTER TABLE notifications ADD COLUMN ${col};`)
  }

  // ============================================
  // Step 3: 新規テーブルの作成
  // ============================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS statuses_mentions (
      compositeKey  TEXT NOT NULL,
      acct          TEXT NOT NULL,
      PRIMARY KEY (compositeKey, acct),
      FOREIGN KEY (compositeKey) REFERENCES statuses(compositeKey) ON DELETE CASCADE
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS muted_accounts (
      backendUrl    TEXT NOT NULL,
      account_acct  TEXT NOT NULL,
      muted_at      INTEGER NOT NULL,
      PRIMARY KEY (backendUrl, account_acct)
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS blocked_instances (
      instance_domain TEXT PRIMARY KEY,
      blocked_at      INTEGER NOT NULL
    );
  `)

  // ============================================
  // Step 4: 新規インデックスの作成
  // ============================================
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_account_acct ON statuses(account_acct);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_reblog_of_id ON statuses(reblog_of_id);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_media_filter ON statuses(backendUrl, has_media, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_visibility_filter ON statuses(backendUrl, visibility, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_language_filter ON statuses(backendUrl, language, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_reblog_filter ON statuses(backendUrl, is_reblog, created_at_ms DESC);',
  )
  db.exec('CREATE INDEX IF NOT EXISTS idx_sm_acct ON statuses_mentions(acct);')
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(notification_type);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_status_id ON notifications(backendUrl, status_id);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_account_acct ON notifications(account_acct);',
  )

  // ============================================
  // Step 5: バックフィル
  // ============================================
  backfillStatusesV2(handle)
  backfillNotificationsV2(handle)
  backfillMentionsV2(handle)
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
function migrateV2toV3(handle: DbHandle): void {
  const { db } = handle

  // ============================================
  // Step 1: statuses テーブルへのカラム追加
  // ============================================
  db.exec("ALTER TABLE statuses ADD COLUMN uri TEXT NOT NULL DEFAULT '';")
  db.exec('ALTER TABLE statuses ADD COLUMN reblog_of_uri TEXT;')

  // ============================================
  // Step 2: statuses_backends テーブルの作成
  // ============================================
  db.exec(`
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
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_reblog_of_uri ON statuses(reblog_of_uri);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_sb_compositeKey ON statuses_backends(compositeKey);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_sb_backendUrl ON statuses_backends(backendUrl);',
  )

  // ============================================
  // Step 4: uri / reblog_of_uri のバックフィル
  // ============================================
  backfillStatusesV3(handle)

  // ============================================
  // Step 5: statuses_backends のバックフィル
  //
  // compositeKey は "backendUrl:statusId" 形式。
  // backendUrl の長さ + 1（':' の分）以降が local_id。
  // ============================================
  db.exec(`
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
  deduplicateByUri(handle)

  // ============================================
  // Step 7: UNIQUEインデックスの作成（重複排除後）
  // ============================================
  db.exec(
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
function backfillStatusesV2(handle: DbHandle): void {
  const { db } = handle

  db.exec(`
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
function backfillNotificationsV2(handle: DbHandle): void {
  const { db } = handle

  db.exec(`
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
function backfillMentionsV2(handle: DbHandle): void {
  const { db } = handle

  db.exec(`
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
function backfillStatusesV3(handle: DbHandle): void {
  const { db } = handle

  // uri のバックフィル
  db.exec(`
    UPDATE statuses SET
      uri = COALESCE(json_extract(json, '$.uri'), '')
    WHERE uri = '';
  `)

  // reblog_of_uri のバックフィル
  db.exec(`
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
function deduplicateByUri(handle: DbHandle): void {
  const { db } = handle

  // 重複 URI を検出（空文字列は除外）
  const dupes = db.exec(
    `SELECT uri FROM statuses
     WHERE uri != ''
     GROUP BY uri
     HAVING COUNT(*) > 1;`,
    { returnValue: 'resultRows' },
  ) as string[][]

  if (dupes.length === 0) return

  for (const [uri] of dupes) {
    // storedAt 降順で全行取得（最新が先頭 = 勝者）
    const rows = db.exec(
      `SELECT compositeKey FROM statuses
       WHERE uri = ?
       ORDER BY storedAt DESC;`,
      { bind: [uri], returnValue: 'resultRows' },
    ) as string[][]

    if (rows.length < 2) continue

    const winnerKey = rows[0][0]
    const loserKeys = rows.slice(1).map((r) => r[0])

    for (const loserKey of loserKeys) {
      // タイムライン種別をマージ
      db.exec(
        `INSERT OR IGNORE INTO statuses_timeline_types (compositeKey, timelineType)
         SELECT ?, timelineType FROM statuses_timeline_types WHERE compositeKey = ?;`,
        { bind: [winnerKey, loserKey] },
      )

      // タグをマージ
      db.exec(
        `INSERT OR IGNORE INTO statuses_belonging_tags (compositeKey, tag)
         SELECT ?, tag FROM statuses_belonging_tags WHERE compositeKey = ?;`,
        { bind: [winnerKey, loserKey] },
      )

      // メンションをマージ
      db.exec(
        `INSERT OR IGNORE INTO statuses_mentions (compositeKey, acct)
         SELECT ?, acct FROM statuses_mentions WHERE compositeKey = ?;`,
        { bind: [winnerKey, loserKey] },
      )

      // バックエンド情報をマージ（compositeKey を勝者に付け替え）
      // PK は (backendUrl, local_id) なので compositeKey の変更は一意性に影響しない
      db.exec(
        `UPDATE OR IGNORE statuses_backends
         SET compositeKey = ?
         WHERE compositeKey = ?;`,
        { bind: [winnerKey, loserKey] },
      )

      // 敗者行を削除（CASCADE で関連テーブルの残留行も削除）
      db.exec('DELETE FROM statuses WHERE compositeKey = ?;', {
        bind: [loserKey],
      })
    }
  }
}

// ================================================================
// v3 → v4 マイグレーション
// ================================================================

/**
 * v3 → v4 マイグレーション
 *
 * JOIN 最適化用のカバリング複合インデックスを追加する。
 *
 * - statuses_timeline_types(timelineType, compositeKey)
 *   → JOIN ON stt.compositeKey = s.compositeKey WHERE stt.timelineType = ? を高速化
 *
 * - statuses_belonging_tags(tag, compositeKey)
 *   → JOIN ON sbt.compositeKey = s.compositeKey WHERE sbt.tag = ? を高速化
 *
 * - statuses_backends(backendUrl, compositeKey)
 *   → JOIN ON sb.compositeKey = s.compositeKey WHERE sb.backendUrl IN (...) を高速化
 */
function migrateV3toV4(handle: DbHandle): void {
  const { db } = handle

  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_stt_type_key ON statuses_timeline_types(timelineType, compositeKey);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_sbt_tag_key ON statuses_belonging_tags(tag, compositeKey);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_sb_backend_key ON statuses_backends(backendUrl, compositeKey);',
  )
}

// ================================================================
// v4 → v5 マイグレーション
// ================================================================

/**
 * v4 → v5 マイグレーション
 *
 * リブログ関係を管理する statuses_reblogs テーブルを追加し、
 * 既存のリブログデータからバックフィルする。
 */
function migrateV4toV5(handle: DbHandle): void {
  createReblogsTable(handle)
  backfillReblogsV5(handle)
}

/**
 * statuses_reblogs テーブルとインデックスの作成
 */
function createReblogsTable(handle: DbHandle): void {
  const { db } = handle

  db.exec(`
    CREATE TABLE IF NOT EXISTS statuses_reblogs (
      compositeKey    TEXT NOT NULL,
      original_uri    TEXT NOT NULL DEFAULT '',
      reblogger_acct  TEXT NOT NULL DEFAULT '',
      reblogged_at_ms INTEGER NOT NULL,
      PRIMARY KEY (compositeKey),
      FOREIGN KEY (compositeKey) REFERENCES statuses(compositeKey) ON DELETE CASCADE
    );
  `)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_sr_original_uri ON statuses_reblogs(original_uri);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_sr_reblogger_acct ON statuses_reblogs(reblogger_acct);',
  )
}

/**
 * statuses_reblogs の v5 バックフィル
 *
 * 既存の is_reblog = 1 の行から reblog_of_uri / account_acct を抽出して
 * statuses_reblogs に挿入する。
 */
function backfillReblogsV5(handle: DbHandle): void {
  const { db } = handle

  db.exec(`
    INSERT OR IGNORE INTO statuses_reblogs (compositeKey, original_uri, reblogger_acct, reblogged_at_ms)
    SELECT compositeKey, reblog_of_uri, account_acct, created_at_ms
    FROM statuses
    WHERE is_reblog = 1 AND reblog_of_uri IS NOT NULL AND reblog_of_uri != '';
  `)
}

// ================================================================
// v5 → v6 マイグレーション
// ================================================================

/**
 * v5 → v6 マイグレーション
 *
 * タイムライン高速化のためのマテリアライズド・ビューを追加し、
 * 既存データからバックフィル、自動同期トリガーとカスタムクエリ用インデックスを作成する。
 */
function migrateV5toV6(handle: DbHandle): void {
  createMaterializedViewTables(handle)
  createMaterializedViewTriggers(handle)
  createCustomQueryIndexes(handle)
  backfillMaterializedViewsV6(handle)
}

// ================================================================
// マテリアライズド・ビュー テーブル作成
// ================================================================

/**
 * timeline_entries / tag_entries テーブルとインデックスの作成
 *
 * フィルタ用の正規化カラムを含めた実体化テーブルを作成し、
 * カバーリングインデックスを付与することで読み取りを高速化する。
 */
function createMaterializedViewTables(handle: DbHandle): void {
  const { db } = handle

  // ============================================
  // timeline_entries（タイムライン用マテリアライズド・ビュー）
  // ============================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS timeline_entries (
      compositeKey     TEXT NOT NULL,
      timelineType     TEXT NOT NULL,
      backendUrl       TEXT NOT NULL,
      created_at_ms    INTEGER NOT NULL,
      has_media        INTEGER NOT NULL DEFAULT 0,
      media_count      INTEGER NOT NULL DEFAULT 0,
      visibility       TEXT NOT NULL DEFAULT 'public',
      language         TEXT,
      is_reblog        INTEGER NOT NULL DEFAULT 0,
      in_reply_to_id   TEXT,
      has_spoiler      INTEGER NOT NULL DEFAULT 0,
      is_sensitive     INTEGER NOT NULL DEFAULT 0,
      account_acct     TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (timelineType, backendUrl, compositeKey),
      FOREIGN KEY (compositeKey) REFERENCES statuses(compositeKey) ON DELETE CASCADE
    );
  `)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_te_cover ON timeline_entries(timelineType, backendUrl, created_at_ms DESC);',
  )

  // ============================================
  // tag_entries（タグ用マテリアライズド・ビュー）
  // ============================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS tag_entries (
      compositeKey     TEXT NOT NULL,
      tag              TEXT NOT NULL,
      backendUrl       TEXT NOT NULL,
      created_at_ms    INTEGER NOT NULL,
      has_media        INTEGER NOT NULL DEFAULT 0,
      media_count      INTEGER NOT NULL DEFAULT 0,
      visibility       TEXT NOT NULL DEFAULT 'public',
      language         TEXT,
      is_reblog        INTEGER NOT NULL DEFAULT 0,
      in_reply_to_id   TEXT,
      has_spoiler      INTEGER NOT NULL DEFAULT 0,
      is_sensitive     INTEGER NOT NULL DEFAULT 0,
      account_acct     TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (tag, backendUrl, compositeKey),
      FOREIGN KEY (compositeKey) REFERENCES statuses(compositeKey) ON DELETE CASCADE
    );
  `)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_tge_cover ON tag_entries(tag, backendUrl, created_at_ms DESC);',
  )
}

// ================================================================
// マテリアライズド・ビュー 自動同期トリガー
// ================================================================

/**
 * statuses / statuses_timeline_types / statuses_belonging_tags / statuses_backends の
 * 変更を timeline_entries / tag_entries に自動反映するトリガーを作成する。
 *
 * ## トリガー一覧
 *
 * - trg_mv_stt_insert: statuses_timeline_types INSERT → timeline_entries に追加
 * - trg_mv_stt_delete: statuses_timeline_types DELETE → timeline_entries から削除
 * - trg_mv_sbt_insert: statuses_belonging_tags INSERT → tag_entries に追加
 * - trg_mv_sbt_delete: statuses_belonging_tags DELETE → tag_entries から削除
 * - trg_mv_sb_insert: statuses_backends INSERT → 既存の timeline_types/tags に対応する行を追加
 * - trg_mv_sb_delete: statuses_backends DELETE → 該当 backendUrl の行を削除
 * - trg_mv_status_update: statuses UPDATE → フィルタカラムを同期
 */
function createMaterializedViewTriggers(handle: DbHandle): void {
  const { db } = handle

  // ----------------------------------------
  // statuses_timeline_types INSERT → timeline_entries
  // ----------------------------------------
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_mv_stt_insert
    AFTER INSERT ON statuses_timeline_types
    BEGIN
      INSERT OR IGNORE INTO timeline_entries (
        compositeKey, timelineType, backendUrl, created_at_ms,
        has_media, media_count, visibility, language,
        is_reblog, in_reply_to_id, has_spoiler, is_sensitive, account_acct
      )
      SELECT
        NEW.compositeKey, NEW.timelineType, sb.backendUrl, s.created_at_ms,
        s.has_media, s.media_count, s.visibility, s.language,
        s.is_reblog, s.in_reply_to_id, s.has_spoiler, s.is_sensitive, s.account_acct
      FROM statuses s
      INNER JOIN statuses_backends sb ON s.compositeKey = sb.compositeKey
      WHERE s.compositeKey = NEW.compositeKey;
    END;
  `)

  // ----------------------------------------
  // statuses_timeline_types DELETE → timeline_entries
  // ----------------------------------------
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_mv_stt_delete
    AFTER DELETE ON statuses_timeline_types
    BEGIN
      DELETE FROM timeline_entries
      WHERE compositeKey = OLD.compositeKey AND timelineType = OLD.timelineType;
    END;
  `)

  // ----------------------------------------
  // statuses_belonging_tags INSERT → tag_entries
  // ----------------------------------------
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_mv_sbt_insert
    AFTER INSERT ON statuses_belonging_tags
    BEGIN
      INSERT OR IGNORE INTO tag_entries (
        compositeKey, tag, backendUrl, created_at_ms,
        has_media, media_count, visibility, language,
        is_reblog, in_reply_to_id, has_spoiler, is_sensitive, account_acct
      )
      SELECT
        NEW.compositeKey, NEW.tag, sb.backendUrl, s.created_at_ms,
        s.has_media, s.media_count, s.visibility, s.language,
        s.is_reblog, s.in_reply_to_id, s.has_spoiler, s.is_sensitive, s.account_acct
      FROM statuses s
      INNER JOIN statuses_backends sb ON s.compositeKey = sb.compositeKey
      WHERE s.compositeKey = NEW.compositeKey;
    END;
  `)

  // ----------------------------------------
  // statuses_belonging_tags DELETE → tag_entries
  // ----------------------------------------
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_mv_sbt_delete
    AFTER DELETE ON statuses_belonging_tags
    BEGIN
      DELETE FROM tag_entries
      WHERE compositeKey = OLD.compositeKey AND tag = OLD.tag;
    END;
  `)

  // ----------------------------------------
  // statuses_backends INSERT → timeline_entries + tag_entries
  // （新しいバックエンドが追加された場合、既存の timeline_types / tags に対応する行を追加）
  // ----------------------------------------
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_mv_sb_insert
    AFTER INSERT ON statuses_backends
    BEGIN
      INSERT OR IGNORE INTO timeline_entries (
        compositeKey, timelineType, backendUrl, created_at_ms,
        has_media, media_count, visibility, language,
        is_reblog, in_reply_to_id, has_spoiler, is_sensitive, account_acct
      )
      SELECT
        NEW.compositeKey, stt.timelineType, NEW.backendUrl, s.created_at_ms,
        s.has_media, s.media_count, s.visibility, s.language,
        s.is_reblog, s.in_reply_to_id, s.has_spoiler, s.is_sensitive, s.account_acct
      FROM statuses s
      INNER JOIN statuses_timeline_types stt ON s.compositeKey = stt.compositeKey
      WHERE s.compositeKey = NEW.compositeKey;

      INSERT OR IGNORE INTO tag_entries (
        compositeKey, tag, backendUrl, created_at_ms,
        has_media, media_count, visibility, language,
        is_reblog, in_reply_to_id, has_spoiler, is_sensitive, account_acct
      )
      SELECT
        NEW.compositeKey, sbt.tag, NEW.backendUrl, s.created_at_ms,
        s.has_media, s.media_count, s.visibility, s.language,
        s.is_reblog, s.in_reply_to_id, s.has_spoiler, s.is_sensitive, s.account_acct
      FROM statuses s
      INNER JOIN statuses_belonging_tags sbt ON s.compositeKey = sbt.compositeKey
      WHERE s.compositeKey = NEW.compositeKey;
    END;
  `)

  // ----------------------------------------
  // statuses_backends DELETE → timeline_entries + tag_entries
  // ----------------------------------------
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_mv_sb_delete
    AFTER DELETE ON statuses_backends
    BEGIN
      DELETE FROM timeline_entries
      WHERE compositeKey = OLD.compositeKey AND backendUrl = OLD.backendUrl;

      DELETE FROM tag_entries
      WHERE compositeKey = OLD.compositeKey AND backendUrl = OLD.backendUrl;
    END;
  `)

  // ----------------------------------------
  // statuses UPDATE → フィルタカラムを timeline_entries + tag_entries に同期
  // ----------------------------------------
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_mv_status_update
    AFTER UPDATE ON statuses
    BEGIN
      UPDATE timeline_entries SET
        created_at_ms  = NEW.created_at_ms,
        has_media      = NEW.has_media,
        media_count    = NEW.media_count,
        visibility     = NEW.visibility,
        language       = NEW.language,
        is_reblog      = NEW.is_reblog,
        in_reply_to_id = NEW.in_reply_to_id,
        has_spoiler    = NEW.has_spoiler,
        is_sensitive   = NEW.is_sensitive,
        account_acct   = NEW.account_acct
      WHERE compositeKey = OLD.compositeKey;

      UPDATE tag_entries SET
        created_at_ms  = NEW.created_at_ms,
        has_media      = NEW.has_media,
        media_count    = NEW.media_count,
        visibility     = NEW.visibility,
        language       = NEW.language,
        is_reblog      = NEW.is_reblog,
        in_reply_to_id = NEW.in_reply_to_id,
        has_spoiler    = NEW.has_spoiler,
        is_sensitive   = NEW.is_sensitive,
        account_acct   = NEW.account_acct
      WHERE compositeKey = OLD.compositeKey;
    END;
  `)
}

// ================================================================
// カスタムクエリ用インデックス
// ================================================================

/**
 * カスタムクエリ（通知×ステータス結合クエリ等）のパフォーマンス用インデックスを追加する。
 */
function createCustomQueryIndexes(handle: DbHandle): void {
  const { db } = handle

  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_acct_type_time ON notifications(account_acct, notification_type, created_at_ms);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_statuses_acct_time ON statuses(account_acct, created_at_ms);',
  )
}

// ================================================================
// マテリアライズド・ビュー バックフィル
// ================================================================

/**
 * 既存データから timeline_entries / tag_entries を一括生成するバックフィル
 */
function backfillMaterializedViewsV6(handle: DbHandle): void {
  const { db } = handle

  // timeline_entries のバックフィル
  db.exec(`
    INSERT OR IGNORE INTO timeline_entries (
      compositeKey, timelineType, backendUrl, created_at_ms,
      has_media, media_count, visibility, language,
      is_reblog, in_reply_to_id, has_spoiler, is_sensitive, account_acct
    )
    SELECT
      s.compositeKey, stt.timelineType, sb.backendUrl, s.created_at_ms,
      s.has_media, s.media_count, s.visibility, s.language,
      s.is_reblog, s.in_reply_to_id, s.has_spoiler, s.is_sensitive, s.account_acct
    FROM statuses s
    INNER JOIN statuses_timeline_types stt ON s.compositeKey = stt.compositeKey
    INNER JOIN statuses_backends sb ON s.compositeKey = sb.compositeKey;
  `)

  // tag_entries のバックフィル
  db.exec(`
    INSERT OR IGNORE INTO tag_entries (
      compositeKey, tag, backendUrl, created_at_ms,
      has_media, media_count, visibility, language,
      is_reblog, in_reply_to_id, has_spoiler, is_sensitive, account_acct
    )
    SELECT
      s.compositeKey, sbt.tag, sb.backendUrl, s.created_at_ms,
      s.has_media, s.media_count, s.visibility, s.language,
      s.is_reblog, s.in_reply_to_id, s.has_spoiler, s.is_sensitive, s.account_acct
    FROM statuses s
    INNER JOIN statuses_belonging_tags sbt ON s.compositeKey = sbt.compositeKey
    INNER JOIN statuses_backends sb ON s.compositeKey = sb.compositeKey;
  `)
}
