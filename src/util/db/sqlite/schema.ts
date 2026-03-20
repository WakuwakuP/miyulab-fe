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
const SCHEMA_VERSION = 22

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
      // フレッシュインストール: v19 スキーマを直接作成
      createSchemaV19(handle)
      migrateV19toV20(handle)
      migrateV20toV21(handle)
      migrateV21toV22(handle)
    } else if (currentVersion < 2) {
      migrateV1toV2(handle)
      migrateV2toV3(handle)
      migrateV3toV4(handle)
      migrateV4toV5(handle)
      migrateV5toV6(handle)
      migrateV6toV7(handle)
      migrateV7toV8(handle)
      migrateV8toV9(handle)
      migrateV9toV10(handle)
      migrateV10toV11(handle)
      migrateV11toV12(handle)
      migrateV12toV13(handle)
      migrateV13toV14(handle)
      migrateV15toV16(handle)
      migrateV16toV17(handle)
      migrateV17toV18(handle)
      migrateV18toV19(handle)
      migrateV19toV20(handle)
      migrateV20toV21(handle)
      migrateV21toV22(handle)
    } else if (currentVersion < 3) {
      migrateV2toV3(handle)
      migrateV3toV4(handle)
      migrateV4toV5(handle)
      migrateV5toV6(handle)
      migrateV6toV7(handle)
      migrateV7toV8(handle)
      migrateV8toV9(handle)
      migrateV9toV10(handle)
      migrateV10toV11(handle)
      migrateV11toV12(handle)
      migrateV12toV13(handle)
      migrateV13toV14(handle)
      migrateV15toV16(handle)
      migrateV16toV17(handle)
      migrateV17toV18(handle)
      migrateV18toV19(handle)
      migrateV19toV20(handle)
      migrateV20toV21(handle)
      migrateV21toV22(handle)
    } else if (currentVersion < 4) {
      migrateV3toV4(handle)
      migrateV4toV5(handle)
      migrateV5toV6(handle)
      migrateV6toV7(handle)
      migrateV7toV8(handle)
      migrateV8toV9(handle)
      migrateV9toV10(handle)
      migrateV10toV11(handle)
      migrateV11toV12(handle)
      migrateV12toV13(handle)
      migrateV13toV14(handle)
      migrateV15toV16(handle)
      migrateV16toV17(handle)
      migrateV17toV18(handle)
      migrateV18toV19(handle)
      migrateV19toV20(handle)
      migrateV20toV21(handle)
      migrateV21toV22(handle)
    } else if (currentVersion < 5) {
      migrateV4toV5(handle)
      migrateV5toV6(handle)
      migrateV6toV7(handle)
      migrateV7toV8(handle)
      migrateV8toV9(handle)
      migrateV9toV10(handle)
      migrateV10toV11(handle)
      migrateV11toV12(handle)
      migrateV12toV13(handle)
      migrateV13toV14(handle)
      migrateV15toV16(handle)
      migrateV16toV17(handle)
      migrateV17toV18(handle)
      migrateV18toV19(handle)
      migrateV19toV20(handle)
      migrateV20toV21(handle)
      migrateV21toV22(handle)
    } else if (currentVersion < 6) {
      migrateV5toV6(handle)
      migrateV6toV7(handle)
      migrateV7toV8(handle)
      migrateV8toV9(handle)
      migrateV9toV10(handle)
      migrateV10toV11(handle)
      migrateV11toV12(handle)
      migrateV12toV13(handle)
      migrateV13toV14(handle)
      migrateV15toV16(handle)
      migrateV16toV17(handle)
      migrateV17toV18(handle)
      migrateV18toV19(handle)
      migrateV19toV20(handle)
      migrateV20toV21(handle)
      migrateV21toV22(handle)
    } else if (currentVersion < 7) {
      migrateV6toV7(handle)
      migrateV7toV8(handle)
      migrateV8toV9(handle)
      migrateV9toV10(handle)
      migrateV10toV11(handle)
      migrateV11toV12(handle)
      migrateV12toV13(handle)
      migrateV13toV14(handle)
      migrateV15toV16(handle)
      migrateV16toV17(handle)
      migrateV17toV18(handle)
      migrateV18toV19(handle)
      migrateV19toV20(handle)
      migrateV20toV21(handle)
      migrateV21toV22(handle)
    } else if (currentVersion < 8) {
      migrateV7toV8(handle)
      migrateV8toV9(handle)
      migrateV9toV10(handle)
      migrateV10toV11(handle)
      migrateV11toV12(handle)
      migrateV12toV13(handle)
      migrateV13toV14(handle)
      migrateV15toV16(handle)
      migrateV16toV17(handle)
      migrateV17toV18(handle)
      migrateV18toV19(handle)
      migrateV19toV20(handle)
      migrateV20toV21(handle)
      migrateV21toV22(handle)
    } else if (currentVersion < 9) {
      migrateV8toV9(handle)
      migrateV9toV10(handle)
      migrateV10toV11(handle)
      migrateV11toV12(handle)
      migrateV12toV13(handle)
      migrateV13toV14(handle)
      migrateV15toV16(handle)
      migrateV16toV17(handle)
      migrateV17toV18(handle)
      migrateV18toV19(handle)
      migrateV19toV20(handle)
      migrateV20toV21(handle)
      migrateV21toV22(handle)
    } else if (currentVersion < 10) {
      migrateV9toV10(handle)
      migrateV10toV11(handle)
      migrateV11toV12(handle)
      migrateV12toV13(handle)
      migrateV13toV14(handle)
      migrateV15toV16(handle)
      migrateV16toV17(handle)
      migrateV17toV18(handle)
      migrateV18toV19(handle)
      migrateV19toV20(handle)
      migrateV20toV21(handle)
      migrateV21toV22(handle)
    } else if (currentVersion < 11) {
      migrateV10toV11(handle)
      migrateV11toV12(handle)
      migrateV12toV13(handle)
      migrateV13toV14(handle)
      migrateV15toV16(handle)
      migrateV16toV17(handle)
      migrateV17toV18(handle)
      migrateV18toV19(handle)
      migrateV19toV20(handle)
      migrateV20toV21(handle)
      migrateV21toV22(handle)
    } else if (currentVersion < 12) {
      migrateV11toV12(handle)
      migrateV12toV13(handle)
      migrateV13toV14(handle)
      migrateV15toV16(handle)
      migrateV16toV17(handle)
      migrateV17toV18(handle)
      migrateV18toV19(handle)
      migrateV19toV20(handle)
      migrateV20toV21(handle)
      migrateV21toV22(handle)
    } else if (currentVersion < 13) {
      migrateV12toV13(handle)
      migrateV13toV14(handle)
      migrateV15toV16(handle)
      migrateV16toV17(handle)
      migrateV17toV18(handle)
      migrateV18toV19(handle)
      migrateV19toV20(handle)
      migrateV20toV21(handle)
      migrateV21toV22(handle)
    } else if (currentVersion < 14) {
      migrateV13toV14(handle)
      migrateV15toV16(handle)
      migrateV16toV17(handle)
      migrateV17toV18(handle)
      migrateV18toV19(handle)
      migrateV19toV20(handle)
      migrateV20toV21(handle)
      migrateV21toV22(handle)
    } else if (currentVersion < 16) {
      migrateV15toV16(handle)
      migrateV16toV17(handle)
      migrateV17toV18(handle)
      migrateV18toV19(handle)
      migrateV19toV20(handle)
      migrateV20toV21(handle)
      migrateV21toV22(handle)
    } else if (currentVersion < 17) {
      migrateV16toV17(handle)
      migrateV17toV18(handle)
      migrateV18toV19(handle)
      migrateV19toV20(handle)
      migrateV20toV21(handle)
      migrateV21toV22(handle)
    } else if (currentVersion < 18) {
      migrateV17toV18(handle)
      migrateV18toV19(handle)
      migrateV19toV20(handle)
      migrateV20toV21(handle)
      migrateV21toV22(handle)
    } else if (currentVersion < 19) {
      migrateV18toV19(handle)
      migrateV19toV20(handle)
      migrateV20toV21(handle)
      migrateV21toV22(handle)
    } else if (currentVersion < 20) {
      migrateV19toV20(handle)
      migrateV20toV21(handle)
      migrateV21toV22(handle)
    } else if (currentVersion < 21) {
      migrateV20toV21(handle)
      migrateV21toV22(handle)
    } else if (currentVersion < 22) {
      migrateV21toV22(handle)
    }

    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`)
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }
  db.exec('COMMIT;')
}

// ================================================================
// v19 フルスキーマ作成（フレッシュインストール用）
// ================================================================

/**
 * v19 スキーマのフル作成（フレッシュインストール用）
 *
 * v13 スキーマから posts_timeline_types を廃止し、
 * timelines + timeline_items + feed_events テーブルを導入。
 * v19: timelines(channel_kind_id) インデックス追加。
 */
function createSchemaV19(handle: DbHandle): void {
  createSchemaV13(handle)
  migrateV13toV14(handle)
  migrateV15toV16(handle)
  migrateV16toV17(handle)
  migrateV17toV18(handle)
  migrateV18toV19(handle)
}

// ================================================================
// v13 フルスキーマ作成（v14 から内部呼び出し）
// ================================================================

/**
 * v13 スキーマのフル作成（フレッシュインストール用）
 *
 * v12 スキーマから json カラムとレガシーカラムを除去し、
 * 新規コンテンツカラムを追加。
 */
function createSchemaV13(handle: DbHandle): void {
  createSchemaV12(handle)
  migrateV12toV13(handle)
}

// ================================================================
// v12 フルスキーマ作成（v13 から内部呼び出し）
// ================================================================

/**
 * v12 スキーマのフル作成（フレッシュインストール用）
 *
 * v11 スキーマからマテリアライズドビューを除去し、代替インデックスを追加。
 */
function createSchemaV12(handle: DbHandle): void {
  createSchemaV11(handle)
  removeMaterializedViewsV12(handle)
  createReplacementIndexesV12(handle)
}

// ================================================================
// v11 フルスキーマ作成（v12 から内部呼び出し）
// ================================================================

/**
 * v11 スキーマのフル作成
 *
 * v10 スキーマ + post_engagements テーブル。
 */
function createSchemaV11(handle: DbHandle): void {
  createSchemaV10(handle)
  createEngagementsTableV11(handle)
}

// ================================================================
// v10 フルスキーマ作成（v11 から内部呼び出し）
// ================================================================

/**
 * v10 スキーマのフル作成
 *
 * v9 スキーマ + 投稿データ正規化テーブル。
 */
function createSchemaV10(handle: DbHandle): void {
  createSchemaV9(handle)
  createPostNormalizationTablesV10(handle)
}

// ================================================================
// v9 フルスキーマ作成（v10 から内部呼び出し）
// ================================================================

/**
 * v9 スキーマのフル作成
 *
 * v8 スキーマ + profiles 関連テーブル + author_profile_id / actor_profile_id カラム。
 */
function createSchemaV9(handle: DbHandle): void {
  createSchemaV8(handle)
  createProfileTablesV9(handle)
  addV9Columns(handle)
}

// ================================================================
// v8 フルスキーマ作成（v9 から内部呼び出し）
// ================================================================

/**
 * v8 スキーマのフル作成
 *
 * v7 スキーマ + マスターテーブル群 + server_id / visibility_id / notification_type_id カラム。
 */
function createSchemaV8(handle: DbHandle): void {
  createSchemaV7(handle)
  createMasterTablesV8(handle)
  addV8Columns(handle)
}

// ================================================================
// v7 フルスキーマ作成（v8 から内部呼び出し）
// ================================================================

/**
 * v7 スキーマのフル作成（フレッシュインストール用）
 *
 * compositeKey TEXT PK → post_id INTEGER PK に移行した新スキーマ。
 * テーブル名を statuses → posts に変更し、全関連テーブルの FK を post_id に統一。
 * notifications も notification_id INTEGER PK に変更。
 */
function createSchemaV7(handle: DbHandle): void {
  const { db } = handle

  // ============================================
  // posts テーブル
  // ============================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      post_id           INTEGER PRIMARY KEY,
      object_uri        TEXT NOT NULL DEFAULT '',
      origin_backend_url TEXT NOT NULL,
      created_at_ms     INTEGER NOT NULL,
      stored_at         INTEGER NOT NULL,
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

  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_uri ON posts(object_uri) WHERE object_uri != '';",
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_backend_created ON posts(origin_backend_url, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_account_acct ON posts(account_acct);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_media_filter ON posts(origin_backend_url, has_media, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_visibility_filter ON posts(origin_backend_url, visibility, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_language_filter ON posts(origin_backend_url, language, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_reblog_filter ON posts(origin_backend_url, is_reblog, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_reblog_of_uri ON posts(reblog_of_uri);',
  )
  db.exec('CREATE INDEX IF NOT EXISTS idx_posts_stored_at ON posts(stored_at);')

  // ============================================
  // posts_timeline_types
  // ============================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts_timeline_types (
      post_id       INTEGER NOT NULL,
      timelineType  TEXT NOT NULL,
      PRIMARY KEY (post_id, timelineType),
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
    );
  `)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ptt_type ON posts_timeline_types(timelineType);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ptt_type_key ON posts_timeline_types(timelineType, post_id);',
  )

  // ============================================
  // posts_belonging_tags
  // ============================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts_belonging_tags (
      post_id  INTEGER NOT NULL,
      tag      TEXT NOT NULL,
      PRIMARY KEY (post_id, tag),
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
    );
  `)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_pbt_tag ON posts_belonging_tags(tag);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_pbt_tag_key ON posts_belonging_tags(tag, post_id);',
  )

  // ============================================
  // posts_mentions
  // ============================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts_mentions (
      post_id  INTEGER NOT NULL,
      acct     TEXT NOT NULL,
      PRIMARY KEY (post_id, acct),
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
    );
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_pm_acct ON posts_mentions(acct);')

  // ============================================
  // posts_backends
  // ============================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts_backends (
      post_id     INTEGER NOT NULL,
      backendUrl  TEXT NOT NULL,
      local_id    TEXT NOT NULL,
      PRIMARY KEY (backendUrl, local_id),
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
    );
  `)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_pb_post_id ON posts_backends(post_id);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_pb_backendUrl ON posts_backends(backendUrl);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_pb_backend_key ON posts_backends(backendUrl, post_id);',
  )

  // ============================================
  // posts_reblogs
  // ============================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts_reblogs (
      post_id         INTEGER PRIMARY KEY,
      original_uri    TEXT NOT NULL DEFAULT '',
      reblogger_acct  TEXT NOT NULL DEFAULT '',
      reblogged_at_ms INTEGER NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
    );
  `)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_pr_original_uri ON posts_reblogs(original_uri);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_pr_reblogger_acct ON posts_reblogs(reblogger_acct);',
  )

  // ============================================
  // muted_accounts / blocked_instances
  // ============================================
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
  // notifications テーブル
  // ============================================
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      notification_id   INTEGER PRIMARY KEY,
      backend_url       TEXT NOT NULL,
      local_id          TEXT NOT NULL DEFAULT '',
      created_at_ms     INTEGER NOT NULL,
      stored_at         INTEGER NOT NULL,
      notification_type TEXT NOT NULL DEFAULT '',
      status_id         TEXT,
      account_acct      TEXT NOT NULL DEFAULT '',
      json              TEXT NOT NULL
    );
  `)
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_backend_local ON notifications(backend_url, local_id) WHERE local_id != '';",
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_backend ON notifications(backend_url);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_backend_created ON notifications(backend_url, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_stored_at ON notifications(stored_at);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(notification_type);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_status_id ON notifications(backend_url, status_id);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_account_acct ON notifications(account_acct);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_acct_type_time ON notifications(account_acct, notification_type, created_at_ms);',
  )

  // ============================================
  // マテリアライズド・ビュー
  // ============================================
  createMaterializedViewTablesV7(handle)
  createMaterializedViewTriggersV7(handle)

  // カスタムクエリ用インデックス
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_acct_time ON posts(account_acct, created_at_ms);',
  )
}

// ================================================================
// v7 マテリアライズド・ビュー テーブル作成
// ================================================================

function createMaterializedViewTablesV7(handle: DbHandle): void {
  const { db } = handle

  db.exec(`
    CREATE TABLE IF NOT EXISTS timeline_entries (
      post_id          INTEGER NOT NULL,
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
      PRIMARY KEY (timelineType, backendUrl, post_id),
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
    );
  `)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_te_cover ON timeline_entries(timelineType, backendUrl, created_at_ms DESC);',
  )

  db.exec(`
    CREATE TABLE IF NOT EXISTS tag_entries (
      post_id          INTEGER NOT NULL,
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
      PRIMARY KEY (tag, backendUrl, post_id),
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
    );
  `)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_tge_cover ON tag_entries(tag, backendUrl, created_at_ms DESC);',
  )
}

// ================================================================
// v7 マテリアライズド・ビュー 自動同期トリガー
// ================================================================

function createMaterializedViewTriggersV7(handle: DbHandle): void {
  const { db } = handle

  // posts_timeline_types INSERT → timeline_entries
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_mv_ptt_insert
    AFTER INSERT ON posts_timeline_types
    BEGIN
      INSERT OR IGNORE INTO timeline_entries (
        post_id, timelineType, backendUrl, created_at_ms,
        has_media, media_count, visibility, language,
        is_reblog, in_reply_to_id, has_spoiler, is_sensitive, account_acct
      )
      SELECT
        NEW.post_id, NEW.timelineType, pb.backendUrl, p.created_at_ms,
        p.has_media, p.media_count, p.visibility, p.language,
        p.is_reblog, p.in_reply_to_id, p.has_spoiler, p.is_sensitive, p.account_acct
      FROM posts p
      INNER JOIN posts_backends pb ON p.post_id = pb.post_id
      WHERE p.post_id = NEW.post_id;
    END;
  `)

  // posts_timeline_types DELETE → timeline_entries
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_mv_ptt_delete
    AFTER DELETE ON posts_timeline_types
    BEGIN
      DELETE FROM timeline_entries
      WHERE post_id = OLD.post_id AND timelineType = OLD.timelineType;
    END;
  `)

  // posts_belonging_tags INSERT → tag_entries
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_mv_pbt_insert
    AFTER INSERT ON posts_belonging_tags
    BEGIN
      INSERT OR IGNORE INTO tag_entries (
        post_id, tag, backendUrl, created_at_ms,
        has_media, media_count, visibility, language,
        is_reblog, in_reply_to_id, has_spoiler, is_sensitive, account_acct
      )
      SELECT
        NEW.post_id, NEW.tag, pb.backendUrl, p.created_at_ms,
        p.has_media, p.media_count, p.visibility, p.language,
        p.is_reblog, p.in_reply_to_id, p.has_spoiler, p.is_sensitive, p.account_acct
      FROM posts p
      INNER JOIN posts_backends pb ON p.post_id = pb.post_id
      WHERE p.post_id = NEW.post_id;
    END;
  `)

  // posts_belonging_tags DELETE → tag_entries
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_mv_pbt_delete
    AFTER DELETE ON posts_belonging_tags
    BEGIN
      DELETE FROM tag_entries
      WHERE post_id = OLD.post_id AND tag = OLD.tag;
    END;
  `)

  // posts_backends INSERT → timeline_entries + tag_entries
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_mv_pb_insert
    AFTER INSERT ON posts_backends
    BEGIN
      INSERT OR IGNORE INTO timeline_entries (
        post_id, timelineType, backendUrl, created_at_ms,
        has_media, media_count, visibility, language,
        is_reblog, in_reply_to_id, has_spoiler, is_sensitive, account_acct
      )
      SELECT
        NEW.post_id, ptt.timelineType, NEW.backendUrl, p.created_at_ms,
        p.has_media, p.media_count, p.visibility, p.language,
        p.is_reblog, p.in_reply_to_id, p.has_spoiler, p.is_sensitive, p.account_acct
      FROM posts p
      INNER JOIN posts_timeline_types ptt ON p.post_id = ptt.post_id
      WHERE p.post_id = NEW.post_id;

      INSERT OR IGNORE INTO tag_entries (
        post_id, tag, backendUrl, created_at_ms,
        has_media, media_count, visibility, language,
        is_reblog, in_reply_to_id, has_spoiler, is_sensitive, account_acct
      )
      SELECT
        NEW.post_id, pbt.tag, NEW.backendUrl, p.created_at_ms,
        p.has_media, p.media_count, p.visibility, p.language,
        p.is_reblog, p.in_reply_to_id, p.has_spoiler, p.is_sensitive, p.account_acct
      FROM posts p
      INNER JOIN posts_belonging_tags pbt ON p.post_id = pbt.post_id
      WHERE p.post_id = NEW.post_id;
    END;
  `)

  // posts_backends DELETE → timeline_entries + tag_entries
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_mv_pb_delete
    AFTER DELETE ON posts_backends
    BEGIN
      DELETE FROM timeline_entries
      WHERE post_id = OLD.post_id AND backendUrl = OLD.backendUrl;

      DELETE FROM tag_entries
      WHERE post_id = OLD.post_id AND backendUrl = OLD.backendUrl;
    END;
  `)

  // posts UPDATE → フィルタカラムを timeline_entries + tag_entries に同期
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_mv_post_update
    AFTER UPDATE ON posts
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
      WHERE post_id = OLD.post_id;

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
      WHERE post_id = OLD.post_id;
    END;
  `)
}

// ================================================================
// v6 → v7 マイグレーション
// ================================================================

/**
 * v6 → v7 マイグレーション
 *
 * compositeKey TEXT PK → post_id INTEGER PK への移行。
 * テーブル名を statuses → posts に変更し、全関連テーブルの FK を post_id に統一。
 * notifications も notification_id INTEGER PK に変更。
 *
 * 手順:
 * 1. 既存トリガーを削除
 * 2. key_map (compositeKey → post_id) を作成
 * 3. 新テーブルを作成しデータをコピー
 * 4. 旧テーブルを削除
 * 5. notifications は _new で作成後リネーム
 * 6. マテリアライズド・ビュー + トリガー + インデックスを再作成
 */
function migrateV6toV7(handle: DbHandle): void {
  const { db } = handle

  // ============================================
  // Step 1: 既存トリガーを削除
  // ============================================
  db.exec('DROP TRIGGER IF EXISTS trg_mv_stt_insert;')
  db.exec('DROP TRIGGER IF EXISTS trg_mv_stt_delete;')
  db.exec('DROP TRIGGER IF EXISTS trg_mv_sbt_insert;')
  db.exec('DROP TRIGGER IF EXISTS trg_mv_sbt_delete;')
  db.exec('DROP TRIGGER IF EXISTS trg_mv_sb_insert;')
  db.exec('DROP TRIGGER IF EXISTS trg_mv_sb_delete;')
  db.exec('DROP TRIGGER IF EXISTS trg_mv_status_update;')

  // ============================================
  // Step 2: key_map 作成 (compositeKey → post_id)
  // ============================================
  db.exec(`
    CREATE TEMP TABLE key_map AS
    SELECT compositeKey, ROWID AS post_id FROM statuses;
  `)

  // ============================================
  // Step 3: posts テーブル作成 + データコピー
  // ============================================
  db.exec(`
    CREATE TABLE posts (
      post_id           INTEGER PRIMARY KEY,
      object_uri        TEXT NOT NULL DEFAULT '',
      origin_backend_url TEXT NOT NULL,
      created_at_ms     INTEGER NOT NULL,
      stored_at         INTEGER NOT NULL,
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
  db.exec(`
    INSERT INTO posts (
      post_id, object_uri, origin_backend_url, created_at_ms, stored_at,
      account_acct, account_id, visibility, language,
      has_media, media_count, is_reblog, reblog_of_id, reblog_of_uri,
      is_sensitive, has_spoiler, in_reply_to_id,
      favourites_count, reblogs_count, replies_count, json
    )
    SELECT
      km.post_id, s.uri, s.backendUrl, s.created_at_ms, s.storedAt,
      s.account_acct, s.account_id, s.visibility, s.language,
      s.has_media, s.media_count, s.is_reblog, s.reblog_of_id, s.reblog_of_uri,
      s.is_sensitive, s.has_spoiler, s.in_reply_to_id,
      s.favourites_count, s.reblogs_count, s.replies_count, s.json
    FROM statuses s
    INNER JOIN key_map km ON s.compositeKey = km.compositeKey;
  `)

  // ============================================
  // Step 4: posts_timeline_types
  // ============================================
  db.exec(`
    CREATE TABLE posts_timeline_types (
      post_id       INTEGER NOT NULL,
      timelineType  TEXT NOT NULL,
      PRIMARY KEY (post_id, timelineType),
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
    );
  `)
  db.exec(`
    INSERT INTO posts_timeline_types (post_id, timelineType)
    SELECT km.post_id, stt.timelineType
    FROM statuses_timeline_types stt
    INNER JOIN key_map km ON stt.compositeKey = km.compositeKey;
  `)

  // ============================================
  // Step 5: posts_belonging_tags
  // ============================================
  db.exec(`
    CREATE TABLE posts_belonging_tags (
      post_id  INTEGER NOT NULL,
      tag      TEXT NOT NULL,
      PRIMARY KEY (post_id, tag),
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
    );
  `)
  db.exec(`
    INSERT INTO posts_belonging_tags (post_id, tag)
    SELECT km.post_id, sbt.tag
    FROM statuses_belonging_tags sbt
    INNER JOIN key_map km ON sbt.compositeKey = km.compositeKey;
  `)

  // ============================================
  // Step 6: posts_mentions
  // ============================================
  db.exec(`
    CREATE TABLE posts_mentions (
      post_id  INTEGER NOT NULL,
      acct     TEXT NOT NULL,
      PRIMARY KEY (post_id, acct),
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
    );
  `)
  db.exec(`
    INSERT INTO posts_mentions (post_id, acct)
    SELECT km.post_id, sm.acct
    FROM statuses_mentions sm
    INNER JOIN key_map km ON sm.compositeKey = km.compositeKey;
  `)

  // ============================================
  // Step 7: posts_backends
  // ============================================
  db.exec(`
    CREATE TABLE posts_backends (
      post_id     INTEGER NOT NULL,
      backendUrl  TEXT NOT NULL,
      local_id    TEXT NOT NULL,
      PRIMARY KEY (backendUrl, local_id),
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
    );
  `)
  db.exec(`
    INSERT INTO posts_backends (post_id, backendUrl, local_id)
    SELECT km.post_id, sb.backendUrl, sb.local_id
    FROM statuses_backends sb
    INNER JOIN key_map km ON sb.compositeKey = km.compositeKey;
  `)

  // ============================================
  // Step 8: posts_reblogs
  // ============================================
  db.exec(`
    CREATE TABLE posts_reblogs (
      post_id         INTEGER PRIMARY KEY,
      original_uri    TEXT NOT NULL DEFAULT '',
      reblogger_acct  TEXT NOT NULL DEFAULT '',
      reblogged_at_ms INTEGER NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
    );
  `)
  db.exec(`
    INSERT INTO posts_reblogs (post_id, original_uri, reblogger_acct, reblogged_at_ms)
    SELECT km.post_id, sr.original_uri, sr.reblogger_acct, sr.reblogged_at_ms
    FROM statuses_reblogs sr
    INNER JOIN key_map km ON sr.compositeKey = km.compositeKey;
  `)

  // ============================================
  // Step 9: notifications_new
  // ============================================
  db.exec(`
    CREATE TABLE notifications_new (
      notification_id   INTEGER PRIMARY KEY,
      backend_url       TEXT NOT NULL,
      local_id          TEXT NOT NULL DEFAULT '',
      created_at_ms     INTEGER NOT NULL,
      stored_at         INTEGER NOT NULL,
      notification_type TEXT NOT NULL DEFAULT '',
      status_id         TEXT,
      account_acct      TEXT NOT NULL DEFAULT '',
      json              TEXT NOT NULL
    );
  `)
  db.exec(`
    INSERT INTO notifications_new (
      notification_id, backend_url, local_id, created_at_ms, stored_at,
      notification_type, status_id, account_acct, json
    )
    SELECT
      ROWID, backendUrl, SUBSTR(compositeKey, LENGTH(backendUrl) + 2),
      created_at_ms, storedAt,
      notification_type, status_id, account_acct, json
    FROM notifications;
  `)

  // ============================================
  // Step 10: 旧テーブルを削除
  // ============================================
  db.exec('DROP TABLE IF EXISTS timeline_entries;')
  db.exec('DROP TABLE IF EXISTS tag_entries;')
  db.exec('DROP TABLE IF EXISTS statuses_reblogs;')
  db.exec('DROP TABLE IF EXISTS statuses_backends;')
  db.exec('DROP TABLE IF EXISTS statuses_mentions;')
  db.exec('DROP TABLE IF EXISTS statuses_belonging_tags;')
  db.exec('DROP TABLE IF EXISTS statuses_timeline_types;')
  db.exec('DROP TABLE IF EXISTS statuses;')
  db.exec('DROP TABLE IF EXISTS notifications;')

  // ============================================
  // Step 11: notifications_new → notifications
  // ============================================
  db.exec('ALTER TABLE notifications_new RENAME TO notifications;')

  // ============================================
  // Step 12: key_map を削除
  // ============================================
  db.exec('DROP TABLE IF EXISTS key_map;')

  // ============================================
  // Step 13: posts インデックス
  // ============================================
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_uri ON posts(object_uri) WHERE object_uri != '';",
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_backend_created ON posts(origin_backend_url, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_account_acct ON posts(account_acct);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_media_filter ON posts(origin_backend_url, has_media, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_visibility_filter ON posts(origin_backend_url, visibility, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_language_filter ON posts(origin_backend_url, language, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_reblog_filter ON posts(origin_backend_url, is_reblog, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_reblog_of_uri ON posts(reblog_of_uri);',
  )
  db.exec('CREATE INDEX IF NOT EXISTS idx_posts_stored_at ON posts(stored_at);')
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_acct_time ON posts(account_acct, created_at_ms);',
  )

  // posts_timeline_types インデックス
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ptt_type ON posts_timeline_types(timelineType);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ptt_type_key ON posts_timeline_types(timelineType, post_id);',
  )

  // posts_belonging_tags インデックス
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_pbt_tag ON posts_belonging_tags(tag);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_pbt_tag_key ON posts_belonging_tags(tag, post_id);',
  )

  // posts_mentions インデックス
  db.exec('CREATE INDEX IF NOT EXISTS idx_pm_acct ON posts_mentions(acct);')

  // posts_backends インデックス
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_pb_post_id ON posts_backends(post_id);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_pb_backendUrl ON posts_backends(backendUrl);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_pb_backend_key ON posts_backends(backendUrl, post_id);',
  )

  // posts_reblogs インデックス
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_pr_original_uri ON posts_reblogs(original_uri);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_pr_reblogger_acct ON posts_reblogs(reblogger_acct);',
  )

  // notifications インデックス
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_backend_local ON notifications(backend_url, local_id) WHERE local_id != '';",
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_backend ON notifications(backend_url);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_backend_created ON notifications(backend_url, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_stored_at ON notifications(stored_at);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(notification_type);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_status_id ON notifications(backend_url, status_id);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_account_acct ON notifications(account_acct);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_acct_type_time ON notifications(account_acct, notification_type, created_at_ms);',
  )

  // ============================================
  // Step 14: マテリアライズド・ビュー + トリガー + バックフィル
  // ============================================
  createMaterializedViewTablesV7(handle)
  createMaterializedViewTriggersV7(handle)
  backfillMaterializedViewsV7(handle)
}

/**
 * v7 マテリアライズド・ビューのバックフィル
 */
function backfillMaterializedViewsV7(handle: DbHandle): void {
  const { db } = handle

  db.exec(`
    INSERT OR IGNORE INTO timeline_entries (
      post_id, timelineType, backendUrl, created_at_ms,
      has_media, media_count, visibility, language,
      is_reblog, in_reply_to_id, has_spoiler, is_sensitive, account_acct
    )
    SELECT
      p.post_id, ptt.timelineType, pb.backendUrl, p.created_at_ms,
      p.has_media, p.media_count, p.visibility, p.language,
      p.is_reblog, p.in_reply_to_id, p.has_spoiler, p.is_sensitive, p.account_acct
    FROM posts p
    INNER JOIN posts_timeline_types ptt ON p.post_id = ptt.post_id
    INNER JOIN posts_backends pb ON p.post_id = pb.post_id;
  `)

  db.exec(`
    INSERT OR IGNORE INTO tag_entries (
      post_id, tag, backendUrl, created_at_ms,
      has_media, media_count, visibility, language,
      is_reblog, in_reply_to_id, has_spoiler, is_sensitive, account_acct
    )
    SELECT
      p.post_id, pbt.tag, pb.backendUrl, p.created_at_ms,
      p.has_media, p.media_count, p.visibility, p.language,
      p.is_reblog, p.in_reply_to_id, p.has_spoiler, p.is_sensitive, p.account_acct
    FROM posts p
    INNER JOIN posts_belonging_tags pbt ON p.post_id = pbt.post_id
    INNER JOIN posts_backends pb ON p.post_id = pb.post_id;
  `)
}

// ================================================================
// v8 マスターテーブル作成
// ================================================================

/**
 * v8 マスターテーブル群を作成し、初期データを投入する。
 */
function createMasterTablesV8(handle: DbHandle): void {
  const { db } = handle

  // software_types
  db.exec(`
    CREATE TABLE IF NOT EXISTS software_types (
      software_type_id  INTEGER PRIMARY KEY,
      code              TEXT NOT NULL UNIQUE,
      display_name      TEXT NOT NULL
    );
  `)
  db.exec(`
    INSERT OR IGNORE INTO software_types (code, display_name) VALUES
      ('mastodon', 'Mastodon'),
      ('pleroma', 'Pleroma'),
      ('misskey', 'Misskey'),
      ('firefish', 'Firefish'),
      ('akkoma', 'Akkoma'),
      ('gotosocial', 'GoToSocial'),
      ('unknown', 'Unknown');
  `)

  // servers
  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      server_id         INTEGER PRIMARY KEY,
      host              TEXT NOT NULL UNIQUE,
      base_url          TEXT NOT NULL,
      software_type_id  INTEGER,
      software_version  TEXT,
      detected_at       TEXT,
      FOREIGN KEY (software_type_id) REFERENCES software_types(software_type_id)
    );
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_servers_host ON servers(host);')

  // visibility_types
  db.exec(`
    CREATE TABLE IF NOT EXISTS visibility_types (
      visibility_id  INTEGER PRIMARY KEY,
      code           TEXT NOT NULL UNIQUE,
      display_name   TEXT NOT NULL
    );
  `)
  db.exec(`
    INSERT OR IGNORE INTO visibility_types (code, display_name) VALUES
      ('public', '公開'),
      ('unlisted', '未収載'),
      ('private', 'フォロワー限定'),
      ('direct', 'ダイレクト');
  `)

  // notification_types
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_types (
      notification_type_id  INTEGER PRIMARY KEY,
      code                  TEXT NOT NULL UNIQUE,
      display_name          TEXT NOT NULL
    );
  `)
  db.exec(`
    INSERT OR IGNORE INTO notification_types (code, display_name) VALUES
      ('follow', 'フォロー'),
      ('follow_request', 'フォローリクエスト'),
      ('mention', 'メンション'),
      ('reblog', 'ブースト'),
      ('favourite', 'お気に入り'),
      ('reaction', 'リアクション'),
      ('poll_expired', '投票終了'),
      ('status', '投稿');
  `)

  // media_types
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_types (
      media_type_id  INTEGER PRIMARY KEY,
      code           TEXT NOT NULL UNIQUE,
      display_name   TEXT NOT NULL
    );
  `)
  db.exec(`
    INSERT OR IGNORE INTO media_types (code, display_name) VALUES
      ('image', '画像'),
      ('video', '動画'),
      ('gifv', 'GIF動画'),
      ('audio', '音声'),
      ('unknown', '不明');
  `)

  // engagement_types
  db.exec(`
    CREATE TABLE IF NOT EXISTS engagement_types (
      engagement_type_id  INTEGER PRIMARY KEY,
      code                TEXT NOT NULL UNIQUE,
      display_name        TEXT NOT NULL
    );
  `)
  db.exec(`
    INSERT OR IGNORE INTO engagement_types (code, display_name) VALUES
      ('favourite', 'お気に入り'),
      ('reblog', 'ブースト'),
      ('bookmark', 'ブックマーク'),
      ('reaction', 'リアクション');
  `)

  // channel_kinds
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_kinds (
      channel_kind_id  INTEGER PRIMARY KEY,
      code             TEXT NOT NULL UNIQUE,
      display_name     TEXT NOT NULL
    );
  `)
  db.exec(`
    INSERT OR IGNORE INTO channel_kinds (code, display_name) VALUES
      ('home', 'ホーム'),
      ('local', 'ローカル'),
      ('federated', '連合'),
      ('tag', 'タグ'),
      ('notification', '通知'),
      ('bookmark', 'ブックマーク'),
      ('conversation', 'DM');
  `)

  // timeline_item_kinds
  db.exec(`
    CREATE TABLE IF NOT EXISTS timeline_item_kinds (
      timeline_item_kind_id  INTEGER PRIMARY KEY,
      code                   TEXT NOT NULL UNIQUE,
      display_name           TEXT NOT NULL
    );
  `)
  db.exec(`
    INSERT OR IGNORE INTO timeline_item_kinds (code, display_name) VALUES
      ('post', '投稿'),
      ('notification', '通知'),
      ('event', 'イベント');
  `)
}

// ================================================================
// v8 カラム追加（フレッシュインストール / マイグレーション共用）
// ================================================================

/**
 * v8 で追加されるカラムを ALTER TABLE で追加する。
 * フレッシュインストール時も v7 の CREATE TABLE をそのまま再利用するため、
 * ALTER TABLE で後から追加する形式を取る。
 */
function addV8Columns(handle: DbHandle): void {
  const { db } = handle

  // posts: origin_server_id
  db.exec(
    'ALTER TABLE posts ADD COLUMN origin_server_id INTEGER REFERENCES servers(server_id);',
  )

  // posts: visibility_id
  db.exec(
    'ALTER TABLE posts ADD COLUMN visibility_id INTEGER REFERENCES visibility_types(visibility_id);',
  )

  // posts_backends: server_id
  db.exec(
    'ALTER TABLE posts_backends ADD COLUMN server_id INTEGER REFERENCES servers(server_id);',
  )

  // notifications: server_id
  db.exec(
    'ALTER TABLE notifications ADD COLUMN server_id INTEGER REFERENCES servers(server_id);',
  )

  // notifications: notification_type_id
  db.exec(
    'ALTER TABLE notifications ADD COLUMN notification_type_id INTEGER REFERENCES notification_types(notification_type_id);',
  )
}

// ================================================================
// v7 → v8 マイグレーション
// ================================================================

/**
 * v7 → v8 マイグレーション
 *
 * マスターテーブル群（software_types, servers, visibility_types, notification_types,
 * media_types, engagement_types, channel_kinds, timeline_item_kinds）を作成し、
 * 既存データからサーバー情報を抽出して servers テーブルに移行する。
 * posts / posts_backends / notifications に server_id / visibility_id / notification_type_id を追加。
 */
function migrateV7toV8(handle: DbHandle): void {
  const { db } = handle

  // Step 1: マスターテーブル作成 & 初期データ投入
  createMasterTablesV8(handle)

  // Step 2: カラム追加
  addV8Columns(handle)

  // Step 3: 既存の backendUrl から servers レコードを生成
  db.exec(`
    INSERT OR IGNORE INTO servers (host, base_url)
    SELECT DISTINCT
      REPLACE(REPLACE(origin_backend_url, 'https://', ''), 'http://', '') AS host,
      origin_backend_url AS base_url
    FROM posts
    WHERE origin_backend_url != '';
  `)
  db.exec(`
    INSERT OR IGNORE INTO servers (host, base_url)
    SELECT DISTINCT
      REPLACE(REPLACE(backend_url, 'https://', ''), 'http://', '') AS host,
      backend_url AS base_url
    FROM notifications
    WHERE backend_url != '';
  `)

  // Step 4: posts.origin_server_id をバックフィル
  db.exec(`
    UPDATE posts SET origin_server_id = (
      SELECT s.server_id FROM servers s WHERE s.base_url = posts.origin_backend_url
    )
    WHERE origin_server_id IS NULL;
  `)

  // Step 5: posts_backends.server_id をバックフィル
  db.exec(`
    UPDATE posts_backends SET server_id = (
      SELECT s.server_id FROM servers s WHERE s.base_url = posts_backends.backendUrl
    )
    WHERE server_id IS NULL;
  `)

  // Step 6: notifications.server_id をバックフィル
  db.exec(`
    UPDATE notifications SET server_id = (
      SELECT s.server_id FROM servers s WHERE s.base_url = notifications.backend_url
    )
    WHERE server_id IS NULL;
  `)

  // Step 7: posts.visibility_id をバックフィル
  db.exec(`
    UPDATE posts SET visibility_id = (
      SELECT v.visibility_id FROM visibility_types v WHERE v.code = posts.visibility
    )
    WHERE visibility_id IS NULL;
  `)

  // Step 8: notifications.notification_type_id をバックフィル
  db.exec(`
    UPDATE notifications SET notification_type_id = (
      SELECT nt.notification_type_id FROM notification_types nt
      WHERE nt.code = notifications.notification_type
    )
    WHERE notification_type_id IS NULL;
  `)
}

// ================================================================
// v9 プロフィールテーブル作成
// ================================================================

/**
 * profiles, profile_aliases, profile_fields, local_accounts テーブルを作成する。
 */
function createProfileTablesV9(handle: DbHandle): void {
  const { db } = handle

  // profiles
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      profile_id      INTEGER PRIMARY KEY,
      actor_uri       TEXT NOT NULL UNIQUE,
      home_server_id  INTEGER,
      acct            TEXT,
      username        TEXT NOT NULL,
      domain          TEXT,
      display_name    TEXT,
      note_html       TEXT,
      avatar_url      TEXT,
      header_url      TEXT,
      locked          INTEGER NOT NULL DEFAULT 0,
      bot             INTEGER NOT NULL DEFAULT 0,
      discoverable    INTEGER,
      created_at      TEXT,
      updated_at      TEXT NOT NULL,
      FOREIGN KEY (home_server_id) REFERENCES servers(server_id)
    );
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_profiles_acct ON profiles(acct);')
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_profiles_server ON profiles(home_server_id, profile_id);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);',
  )

  // profile_aliases
  db.exec(`
    CREATE TABLE IF NOT EXISTS profile_aliases (
      profile_alias_id  INTEGER PRIMARY KEY,
      server_id         INTEGER NOT NULL,
      remote_account_id TEXT NOT NULL,
      profile_id        INTEGER NOT NULL,
      fetched_at        TEXT NOT NULL,
      UNIQUE (server_id, remote_account_id),
      FOREIGN KEY (server_id) REFERENCES servers(server_id),
      FOREIGN KEY (profile_id) REFERENCES profiles(profile_id)
    );
  `)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_pa_profile ON profile_aliases(profile_id);',
  )

  // profile_fields
  db.exec(`
    CREATE TABLE IF NOT EXISTS profile_fields (
      profile_field_id  INTEGER PRIMARY KEY,
      profile_id        INTEGER NOT NULL,
      field_name        TEXT NOT NULL,
      field_value       TEXT NOT NULL,
      verified_at       TEXT,
      sort_order        INTEGER NOT NULL,
      UNIQUE (profile_id, sort_order),
      FOREIGN KEY (profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE
    );
  `)

  // local_accounts
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_accounts (
      local_account_id        INTEGER PRIMARY KEY,
      server_id               INTEGER NOT NULL,
      profile_id              INTEGER NOT NULL,
      is_default_post_account INTEGER NOT NULL DEFAULT 0,
      last_authenticated_at   TEXT,
      UNIQUE (server_id, profile_id),
      FOREIGN KEY (server_id) REFERENCES servers(server_id),
      FOREIGN KEY (profile_id) REFERENCES profiles(profile_id)
    );
  `)
}

// ================================================================
// v9 カラム追加
// ================================================================

function addV9Columns(handle: DbHandle): void {
  const { db } = handle

  // posts: author_profile_id
  db.exec(
    'ALTER TABLE posts ADD COLUMN author_profile_id INTEGER REFERENCES profiles(profile_id);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_profile_id, created_at_ms DESC);',
  )

  // notifications: actor_profile_id
  db.exec(
    'ALTER TABLE notifications ADD COLUMN actor_profile_id INTEGER REFERENCES profiles(profile_id);',
  )
}

// ================================================================
// v8 → v9 マイグレーション
// ================================================================

/**
 * v8 → v9 マイグレーション
 *
 * profiles 関連テーブルを作成し、既存データからプロフィールを抽出。
 * posts.author_profile_id / notifications.actor_profile_id を追加・バックフィル。
 */
function migrateV8toV9(handle: DbHandle): void {
  const { db } = handle

  // Step 1: テーブル作成
  createProfileTablesV9(handle)

  // Step 2: カラム追加
  addV9Columns(handle)

  // Step 3: 既存データからプロフィールを抽出
  db.exec(`
    INSERT OR IGNORE INTO profiles (
      actor_uri, acct, username, domain, display_name,
      avatar_url, header_url, locked, bot, updated_at
    )
    SELECT DISTINCT
      json_extract(json, '$.account.url') AS actor_uri,
      json_extract(json, '$.account.acct') AS acct,
      json_extract(json, '$.account.username') AS username,
      CASE
        WHEN INSTR(json_extract(json, '$.account.acct'), '@') > 0
        THEN SUBSTR(json_extract(json, '$.account.acct'),
                    INSTR(json_extract(json, '$.account.acct'), '@') + 1)
        ELSE NULL
      END AS domain,
      json_extract(json, '$.account.display_name') AS display_name,
      json_extract(json, '$.account.avatar') AS avatar_url,
      json_extract(json, '$.account.header') AS header_url,
      COALESCE(json_extract(json, '$.account.locked'), 0) AS locked,
      COALESCE(json_extract(json, '$.account.bot'), 0) AS bot,
      datetime('now') AS updated_at
    FROM posts
    WHERE json_extract(json, '$.account.url') IS NOT NULL
      AND json_extract(json, '$.account.url') != '';
  `)

  // notifications からもプロフィールを抽出
  db.exec(`
    INSERT OR IGNORE INTO profiles (
      actor_uri, acct, username, domain, display_name,
      avatar_url, header_url, locked, bot, updated_at
    )
    SELECT DISTINCT
      json_extract(json, '$.account.url') AS actor_uri,
      json_extract(json, '$.account.acct') AS acct,
      json_extract(json, '$.account.username') AS username,
      CASE
        WHEN INSTR(json_extract(json, '$.account.acct'), '@') > 0
        THEN SUBSTR(json_extract(json, '$.account.acct'),
                    INSTR(json_extract(json, '$.account.acct'), '@') + 1)
        ELSE NULL
      END AS domain,
      json_extract(json, '$.account.display_name') AS display_name,
      json_extract(json, '$.account.avatar') AS avatar_url,
      json_extract(json, '$.account.header') AS header_url,
      COALESCE(json_extract(json, '$.account.locked'), 0) AS locked,
      COALESCE(json_extract(json, '$.account.bot'), 0) AS bot,
      datetime('now') AS updated_at
    FROM notifications
    WHERE json_extract(json, '$.account.url') IS NOT NULL
      AND json_extract(json, '$.account.url') != '';
  `)

  // Step 4: profile_aliases の生成
  db.exec(`
    INSERT OR IGNORE INTO profile_aliases (server_id, remote_account_id, profile_id, fetched_at)
    SELECT DISTINCT
      pb.server_id,
      p.account_id,
      pr.profile_id,
      datetime('now')
    FROM posts p
    INNER JOIN posts_backends pb ON p.post_id = pb.post_id
    INNER JOIN profiles pr ON pr.acct = p.account_acct
    WHERE pb.server_id IS NOT NULL
      AND p.account_id != '';
  `)

  // Step 5: posts.author_profile_id をバックフィル
  db.exec(`
    UPDATE posts SET author_profile_id = (
      SELECT pr.profile_id FROM profiles pr WHERE pr.acct = posts.account_acct
    )
    WHERE author_profile_id IS NULL;
  `)

  // Step 6: notifications.actor_profile_id をバックフィル
  db.exec(`
    UPDATE notifications SET actor_profile_id = (
      SELECT pr.profile_id FROM profiles pr WHERE pr.acct = notifications.account_acct
    )
    WHERE actor_profile_id IS NULL;
  `)

  // Step 7: home_server_id の補完
  db.exec(`
    UPDATE profiles SET home_server_id = (
      SELECT s.server_id FROM servers s WHERE s.host = profiles.domain
    )
    WHERE domain IS NOT NULL AND home_server_id IS NULL;
  `)
}

// ================================================================
// v10 テーブル作成（投稿データ正規化）
// ================================================================

/**
 * v10 で導入するサブテーブルを作成する。
 * post_media, hashtags, post_hashtags, post_stats,
 * custom_emojis, polls, poll_options, link_cards, post_links
 */
function createPostNormalizationTablesV10(handle: DbHandle): void {
  const { db } = handle

  // 4-1. post_media
  db.exec(`
    CREATE TABLE IF NOT EXISTS post_media (
      media_id        INTEGER PRIMARY KEY,
      post_id         INTEGER NOT NULL,
      media_type_id   INTEGER NOT NULL,
      remote_media_id TEXT,
      url             TEXT NOT NULL,
      preview_url     TEXT,
      description     TEXT,
      blurhash        TEXT,
      width           INTEGER,
      height          INTEGER,
      duration_ms     INTEGER,
      sort_order      INTEGER NOT NULL,
      is_sensitive    INTEGER NOT NULL DEFAULT 0,
      UNIQUE (post_id, sort_order),
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE,
      FOREIGN KEY (media_type_id) REFERENCES media_types(media_type_id)
    );
  `)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_post_media_post ON post_media(post_id);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_post_media_type ON post_media(media_type_id);',
  )

  // 4-2. hashtags
  db.exec(`
    CREATE TABLE IF NOT EXISTS hashtags (
      hashtag_id      INTEGER PRIMARY KEY,
      normalized_name TEXT NOT NULL UNIQUE,
      display_name    TEXT NOT NULL
    );
  `)

  // 4-3. post_hashtags
  db.exec(`
    CREATE TABLE IF NOT EXISTS post_hashtags (
      post_id    INTEGER NOT NULL,
      hashtag_id INTEGER NOT NULL,
      sort_order INTEGER,
      PRIMARY KEY (post_id, hashtag_id),
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE,
      FOREIGN KEY (hashtag_id) REFERENCES hashtags(hashtag_id)
    );
  `)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ph_hashtag ON post_hashtags(hashtag_id, post_id);',
  )

  // 4-4. post_stats
  db.exec(`
    CREATE TABLE IF NOT EXISTS post_stats (
      post_id           INTEGER PRIMARY KEY,
      replies_count     INTEGER,
      reblogs_count     INTEGER,
      favourites_count  INTEGER,
      reactions_count   INTEGER,
      quotes_count      INTEGER,
      fetched_at        TEXT NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
    );
  `)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ps_favourites ON post_stats(favourites_count, post_id);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_ps_reblogs ON post_stats(reblogs_count, post_id);',
  )

  // 4-5. custom_emojis
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_emojis (
      emoji_id          INTEGER PRIMARY KEY,
      server_id         INTEGER NOT NULL,
      shortcode         TEXT NOT NULL,
      domain            TEXT,
      image_url         TEXT NOT NULL,
      static_url        TEXT,
      visible_in_picker INTEGER NOT NULL DEFAULT 1,
      UNIQUE (server_id, shortcode),
      FOREIGN KEY (server_id) REFERENCES servers(server_id)
    );
  `)

  // 4-6. polls
  db.exec(`
    CREATE TABLE IF NOT EXISTS polls (
      poll_id       INTEGER PRIMARY KEY,
      post_id       INTEGER NOT NULL UNIQUE,
      expires_at    TEXT,
      multiple      INTEGER NOT NULL DEFAULT 0,
      votes_count   INTEGER,
      voters_count  INTEGER,
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
    );
  `)

  // 4-7. poll_options
  db.exec(`
    CREATE TABLE IF NOT EXISTS poll_options (
      poll_option_id  INTEGER PRIMARY KEY,
      poll_id         INTEGER NOT NULL,
      option_index    INTEGER NOT NULL,
      title           TEXT NOT NULL,
      votes_count     INTEGER,
      UNIQUE (poll_id, option_index),
      FOREIGN KEY (poll_id) REFERENCES polls(poll_id) ON DELETE CASCADE
    );
  `)

  // 4-8. link_cards
  db.exec(`
    CREATE TABLE IF NOT EXISTS link_cards (
      link_card_id  INTEGER PRIMARY KEY,
      canonical_url TEXT NOT NULL UNIQUE,
      title         TEXT,
      description   TEXT,
      image_url     TEXT,
      provider_name TEXT,
      fetched_at    TEXT NOT NULL
    );
  `)

  // 4-9. post_links
  db.exec(`
    CREATE TABLE IF NOT EXISTS post_links (
      post_id       INTEGER NOT NULL,
      link_card_id  INTEGER NOT NULL,
      url_in_post   TEXT NOT NULL,
      sort_order    INTEGER,
      PRIMARY KEY (post_id, link_card_id, url_in_post),
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE,
      FOREIGN KEY (link_card_id) REFERENCES link_cards(link_card_id)
    );
  `)
}

// ================================================================
// v9 → v10 マイグレーション
// ================================================================

/**
 * v9 → v10 マイグレーション
 *
 * 投稿データ正規化テーブルを作成し、既存 JSON からバックフィル。
 */
function migrateV9toV10(handle: DbHandle): void {
  const { db } = handle

  // Step 1: テーブル作成
  createPostNormalizationTablesV10(handle)

  // Step 2: post_media のバックフィル
  db.exec(`
    INSERT OR IGNORE INTO post_media (
      post_id, media_type_id, remote_media_id, url, preview_url,
      description, blurhash, sort_order, is_sensitive
    )
    SELECT
      p.post_id,
      COALESCE(
        (SELECT mt.media_type_id FROM media_types mt
         WHERE mt.code = json_extract(m.value, '$.type')),
        (SELECT mt.media_type_id FROM media_types mt WHERE mt.code = 'unknown')
      ),
      json_extract(m.value, '$.id'),
      json_extract(m.value, '$.url'),
      json_extract(m.value, '$.preview_url'),
      json_extract(m.value, '$.description'),
      json_extract(m.value, '$.blurhash'),
      m.key,
      p.is_sensitive
    FROM posts p, json_each(json_extract(p.json, '$.media_attachments')) m
    WHERE p.has_media = 1;
  `)

  // Step 3: hashtags / post_hashtags のバックフィル
  db.exec(`
    INSERT OR IGNORE INTO hashtags (normalized_name, display_name)
    SELECT DISTINCT LOWER(tag), tag
    FROM posts_belonging_tags;
  `)
  db.exec(`
    INSERT OR IGNORE INTO post_hashtags (post_id, hashtag_id)
    SELECT pbt.post_id, h.hashtag_id
    FROM posts_belonging_tags pbt
    INNER JOIN hashtags h ON LOWER(pbt.tag) = h.normalized_name;
  `)

  // Step 4: post_stats のバックフィル
  db.exec(`
    INSERT OR IGNORE INTO post_stats (
      post_id, replies_count, reblogs_count, favourites_count, fetched_at
    )
    SELECT
      post_id, replies_count, reblogs_count, favourites_count, datetime('now')
    FROM posts;
  `)

  // Step 5: polls のバックフィル
  db.exec(`
    INSERT OR IGNORE INTO polls (post_id, expires_at, multiple, votes_count, voters_count)
    SELECT
      p.post_id,
      json_extract(p.json, '$.poll.expires_at'),
      COALESCE(json_extract(p.json, '$.poll.multiple'), 0),
      json_extract(p.json, '$.poll.votes_count'),
      json_extract(p.json, '$.poll.voters_count')
    FROM posts p
    WHERE json_extract(p.json, '$.poll') IS NOT NULL;
  `)
  db.exec(`
    INSERT OR IGNORE INTO poll_options (poll_id, option_index, title, votes_count)
    SELECT
      pl.poll_id,
      o.key,
      json_extract(o.value, '$.title'),
      json_extract(o.value, '$.votes_count')
    FROM polls pl
    INNER JOIN posts p ON pl.post_id = p.post_id,
    json_each(json_extract(p.json, '$.poll.options')) o;
  `)

  // Step 6: link_cards のバックフィル
  db.exec(`
    INSERT OR IGNORE INTO link_cards (
      canonical_url, title, description, image_url, provider_name, fetched_at
    )
    SELECT DISTINCT
      json_extract(p.json, '$.card.url'),
      json_extract(p.json, '$.card.title'),
      json_extract(p.json, '$.card.description'),
      json_extract(p.json, '$.card.image'),
      json_extract(p.json, '$.card.provider_name'),
      datetime('now')
    FROM posts p
    WHERE json_extract(p.json, '$.card.url') IS NOT NULL
      AND json_extract(p.json, '$.card.url') != '';
  `)
  db.exec(`
    INSERT OR IGNORE INTO post_links (post_id, link_card_id, url_in_post, sort_order)
    SELECT
      p.post_id,
      lc.link_card_id,
      json_extract(p.json, '$.card.url'),
      0
    FROM posts p
    INNER JOIN link_cards lc ON lc.canonical_url = json_extract(p.json, '$.card.url')
    WHERE json_extract(p.json, '$.card.url') IS NOT NULL;
  `)
}

// ================================================================
// v11 テーブル作成（エンゲージメント統一）
// ================================================================

/**
 * v11 で導入する post_engagements テーブルを作成する。
 */
function createEngagementsTableV11(handle: DbHandle): void {
  const { db } = handle

  db.exec(`
    CREATE TABLE IF NOT EXISTS post_engagements (
      post_engagement_id  INTEGER PRIMARY KEY,
      local_account_id    INTEGER NOT NULL,
      post_id             INTEGER NOT NULL,
      engagement_type_id  INTEGER NOT NULL,
      emoji_id            INTEGER,
      emoji_text          TEXT,
      created_at          TEXT NOT NULL,
      FOREIGN KEY (local_account_id) REFERENCES local_accounts(local_account_id),
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE,
      FOREIGN KEY (engagement_type_id) REFERENCES engagement_types(engagement_type_id),
      FOREIGN KEY (emoji_id) REFERENCES custom_emojis(emoji_id)
    );
  `)

  // favourite / reblog / bookmark は (account, post, type) で一意
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pe_unique
    ON post_engagements(local_account_id, post_id, engagement_type_id)
    WHERE emoji_id IS NULL AND emoji_text IS NULL;
  `)

  // reaction は「投稿に1件」なので (account, post, type) で一意
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pe_unique_reaction
    ON post_engagements(local_account_id, post_id, engagement_type_id)
    WHERE emoji_id IS NOT NULL OR emoji_text IS NOT NULL;
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pe_account_type
    ON post_engagements(local_account_id, engagement_type_id, created_at DESC);
  `)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_pe_post ON post_engagements(post_id);',
  )
}

// ================================================================
// v10 → v11 マイグレーション
// ================================================================

/**
 * v10 → v11 マイグレーション
 *
 * post_engagements テーブルを作成し、既存 JSON のフラグからバックフィル。
 * local_accounts にデータが未投入の場合、バックフィルは空になる。
 */
function migrateV10toV11(handle: DbHandle): void {
  const { db } = handle

  // Step 1: テーブル作成
  createEngagementsTableV11(handle)

  // Step 2: 既存データのバックフィル
  // favourite
  db.exec(`
    INSERT OR IGNORE INTO post_engagements (
      local_account_id, post_id, engagement_type_id, created_at
    )
    SELECT
      la.local_account_id,
      p.post_id,
      (SELECT engagement_type_id FROM engagement_types WHERE code = 'favourite'),
      datetime('now')
    FROM posts p
    INNER JOIN posts_backends pb ON p.post_id = pb.post_id
    INNER JOIN servers sv ON pb.server_id = sv.server_id
    INNER JOIN local_accounts la ON la.server_id = sv.server_id
    WHERE json_extract(p.json, '$.favourited') = 1;
  `)

  // reblog
  db.exec(`
    INSERT OR IGNORE INTO post_engagements (
      local_account_id, post_id, engagement_type_id, created_at
    )
    SELECT
      la.local_account_id,
      p.post_id,
      (SELECT engagement_type_id FROM engagement_types WHERE code = 'reblog'),
      datetime('now')
    FROM posts p
    INNER JOIN posts_backends pb ON p.post_id = pb.post_id
    INNER JOIN servers sv ON pb.server_id = sv.server_id
    INNER JOIN local_accounts la ON la.server_id = sv.server_id
    WHERE json_extract(p.json, '$.reblogged') = 1;
  `)

  // bookmark
  db.exec(`
    INSERT OR IGNORE INTO post_engagements (
      local_account_id, post_id, engagement_type_id, created_at
    )
    SELECT
      la.local_account_id,
      p.post_id,
      (SELECT engagement_type_id FROM engagement_types WHERE code = 'bookmark'),
      datetime('now')
    FROM posts p
    INNER JOIN posts_backends pb ON p.post_id = pb.post_id
    INNER JOIN servers sv ON pb.server_id = sv.server_id
    INNER JOIN local_accounts la ON la.server_id = sv.server_id
    WHERE json_extract(p.json, '$.bookmarked') = 1;
  `)
}

// ================================================================
// v11 → v12 マイグレーション
// ================================================================

/**
 * v11 → v12 マイグレーション
 *
 * timeline_entries / tag_entries マテリアライズドビューと
 * 7 つの自動同期トリガーを廃止し、代替インデックスを作成する。
 */
function migrateV11toV12(handle: DbHandle): void {
  removeMaterializedViewsV12(handle)
  createReplacementIndexesV12(handle)
}

/**
 * マテリアライズドビュー関連のトリガーとテーブルを削除する
 */
function removeMaterializedViewsV12(handle: DbHandle): void {
  const { db } = handle

  // V7 トリガーの削除
  db.exec('DROP TRIGGER IF EXISTS trg_mv_ptt_insert;')
  db.exec('DROP TRIGGER IF EXISTS trg_mv_ptt_delete;')
  db.exec('DROP TRIGGER IF EXISTS trg_mv_pbt_insert;')
  db.exec('DROP TRIGGER IF EXISTS trg_mv_pbt_delete;')
  db.exec('DROP TRIGGER IF EXISTS trg_mv_pb_insert;')
  db.exec('DROP TRIGGER IF EXISTS trg_mv_pb_delete;')
  db.exec('DROP TRIGGER IF EXISTS trg_mv_post_update;')

  // V6 トリガーの削除（安全のため）
  db.exec('DROP TRIGGER IF EXISTS trg_mv_stt_insert;')
  db.exec('DROP TRIGGER IF EXISTS trg_mv_stt_delete;')
  db.exec('DROP TRIGGER IF EXISTS trg_mv_sbt_insert;')
  db.exec('DROP TRIGGER IF EXISTS trg_mv_sbt_delete;')
  db.exec('DROP TRIGGER IF EXISTS trg_mv_sb_insert;')
  db.exec('DROP TRIGGER IF EXISTS trg_mv_sb_delete;')
  db.exec('DROP TRIGGER IF EXISTS trg_mv_status_update;')

  // マテビューテーブルの削除
  db.exec('DROP TABLE IF EXISTS timeline_entries;')
  db.exec('DROP TABLE IF EXISTS tag_entries;')
}

/**
 * マテビュー廃止後の代替インデックスを作成する
 *
 * JOIN ベースのタイムラインクエリを高速化するためのインデックス。
 * 既存インデックスと重複するものはスキップ。
 */
function createReplacementIndexesV12(handle: DbHandle): void {
  const { db } = handle

  // posts: ソート + フィルタ用複合インデックス
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_created_media ON posts(created_at_ms DESC, has_media);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_created_visibility ON posts(created_at_ms DESC, visibility);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_posts_created_reblog ON posts(created_at_ms DESC, is_reblog);',
  )
}

// ================================================================
// v12 → v13 マイグレーション: JSON blob 廃止
// ================================================================

/**
 * v12 → v13 マイグレーション
 *
 * posts.json / notifications.json カラムを廃止し、
 * 不足していたコンテンツカラムを追加してテーブルを再構築する。
 * レガシーカラム（origin_backend_url, account_acct 等）も除去。
 */
function migrateV12toV13(handle: DbHandle): void {
  const { db } = handle

  // Step 1: posts テーブルに不足カラムを追加
  db.exec('ALTER TABLE posts ADD COLUMN content_html TEXT;')
  db.exec('ALTER TABLE posts ADD COLUMN spoiler_text TEXT;')
  db.exec(
    'ALTER TABLE posts ADD COLUMN is_local_only INTEGER NOT NULL DEFAULT 0;',
  )
  db.exec('ALTER TABLE posts ADD COLUMN edited_at TEXT;')
  db.exec('ALTER TABLE posts ADD COLUMN canonical_url TEXT;')

  // Step 2: 新カラムへのバックフィル
  db.exec(`
    UPDATE posts SET
      content_html  = json_extract(json, '$.content'),
      spoiler_text  = json_extract(json, '$.spoiler_text'),
      edited_at     = json_extract(json, '$.edited_at'),
      canonical_url = json_extract(json, '$.url');
  `)

  // Step 3: notifications に related_post_id を追加しバックフィル
  db.exec(
    'ALTER TABLE notifications ADD COLUMN related_post_id INTEGER REFERENCES posts(post_id);',
  )
  db.exec(`
    UPDATE notifications SET related_post_id = (
      SELECT pb.post_id FROM posts_backends pb
      WHERE pb.backendUrl = notifications.backend_url
        AND pb.local_id = notifications.status_id
    ) WHERE status_id IS NOT NULL;
  `)

  // Step 4: posts テーブルを json / レガシーカラムなしで再構築
  db.exec(`
    CREATE TABLE posts_v13 (
      post_id           INTEGER PRIMARY KEY,
      object_uri        TEXT NOT NULL DEFAULT '',
      origin_server_id  INTEGER,
      author_profile_id INTEGER,
      created_at_ms     INTEGER NOT NULL,
      stored_at         INTEGER NOT NULL,
      visibility_id     INTEGER,
      language          TEXT,
      content_html      TEXT,
      spoiler_text      TEXT,
      canonical_url     TEXT,
      has_media         INTEGER NOT NULL DEFAULT 0,
      media_count       INTEGER NOT NULL DEFAULT 0,
      is_reblog         INTEGER NOT NULL DEFAULT 0,
      reblog_of_uri     TEXT,
      is_sensitive      INTEGER NOT NULL DEFAULT 0,
      has_spoiler       INTEGER NOT NULL DEFAULT 0,
      in_reply_to_id    TEXT,
      is_local_only     INTEGER NOT NULL DEFAULT 0,
      edited_at         TEXT,
      FOREIGN KEY (origin_server_id) REFERENCES servers(server_id),
      FOREIGN KEY (author_profile_id) REFERENCES profiles(profile_id),
      FOREIGN KEY (visibility_id) REFERENCES visibility_types(visibility_id)
    );
  `)
  db.exec(`
    INSERT INTO posts_v13
    SELECT
      post_id, object_uri, origin_server_id, author_profile_id,
      created_at_ms, stored_at, visibility_id, language,
      content_html, spoiler_text, canonical_url,
      has_media, media_count, is_reblog, reblog_of_uri,
      is_sensitive, has_spoiler, in_reply_to_id, is_local_only, edited_at
    FROM posts;
  `)

  // Step 4b: notifications テーブルを再構築（local_id は dedup 用に保持）
  db.exec(`
    CREATE TABLE notifications_v13 (
      notification_id      INTEGER PRIMARY KEY,
      server_id            INTEGER,
      local_id             TEXT NOT NULL DEFAULT '',
      notification_type_id INTEGER,
      actor_profile_id     INTEGER,
      related_post_id      INTEGER,
      created_at_ms        INTEGER NOT NULL,
      stored_at            INTEGER NOT NULL,
      is_read              INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (server_id) REFERENCES servers(server_id),
      FOREIGN KEY (notification_type_id) REFERENCES notification_types(notification_type_id),
      FOREIGN KEY (actor_profile_id) REFERENCES profiles(profile_id),
      FOREIGN KEY (related_post_id) REFERENCES posts_v13(post_id)
    );
  `)
  db.exec(`
    INSERT INTO notifications_v13
    SELECT
      notification_id, server_id, local_id, notification_type_id,
      actor_profile_id, related_post_id, created_at_ms, stored_at, 0
    FROM notifications;
  `)

  // Step 5: テーブル置き換え
  db.exec('DROP TABLE posts;')
  db.exec('ALTER TABLE posts_v13 RENAME TO posts;')
  db.exec('DROP TABLE notifications;')
  db.exec('ALTER TABLE notifications_v13 RENAME TO notifications;')

  // Step 6: インデックス再作成
  db.exec(
    "CREATE UNIQUE INDEX idx_posts_uri ON posts(object_uri) WHERE object_uri != '';",
  )
  db.exec('CREATE INDEX idx_posts_created ON posts(created_at_ms DESC);')
  db.exec(
    'CREATE INDEX idx_posts_author ON posts(author_profile_id, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX idx_posts_server ON posts(origin_server_id, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX idx_posts_visibility ON posts(visibility_id, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX idx_posts_language ON posts(language, created_at_ms DESC);',
  )
  db.exec('CREATE INDEX idx_posts_stored_at ON posts(stored_at);')
  db.exec('CREATE INDEX idx_posts_reblog_of_uri ON posts(reblog_of_uri);')
  db.exec(
    'CREATE INDEX idx_posts_created_media ON posts(created_at_ms DESC, has_media);',
  )
  db.exec(
    'CREATE INDEX idx_posts_created_reblog ON posts(created_at_ms DESC, is_reblog);',
  )

  db.exec(
    "CREATE UNIQUE INDEX idx_notifications_server_local ON notifications(server_id, local_id) WHERE local_id != '';",
  )
  db.exec(
    'CREATE INDEX idx_notifications_created ON notifications(created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX idx_notifications_type ON notifications(notification_type_id, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX idx_notifications_actor ON notifications(actor_profile_id, created_at_ms DESC);',
  )
  db.exec(
    'CREATE INDEX idx_notifications_stored_at ON notifications(stored_at);',
  )
  db.exec(
    'CREATE INDEX idx_notifications_related_post ON notifications(related_post_id);',
  )
  db.exec(
    'CREATE INDEX idx_notifications_type_actor ON notifications(notification_type_id, actor_profile_id, created_at_ms DESC);',
  )
}

// ================================================================
// v13 → v14 マイグレーション: タイムライン再構築
// ================================================================

/**
 * posts_timeline_types を廃止し、timelines + timeline_items + feed_events に移行する。
 *
 * - timelines: server_id × channel_kind_id × tag で論理タイムラインを定義
 * - timeline_items: 各タイムラインに属する投稿/通知を管理
 * - feed_events: 投稿・通知の統合時系列表示用（テーブル作成のみ）
 */
function migrateV13toV14(handle: DbHandle): void {
  const { db } = handle

  // Step 1: channel_kinds に 'public' を追加（アプリは 'public' を使用、既存は 'federated'）
  db.exec(
    "INSERT OR IGNORE INTO channel_kinds (code, display_name) VALUES ('public', '連合（パブリック）');",
  )

  // Step 2: timelines テーブル作成
  db.exec(`
    CREATE TABLE timelines (
      timeline_id      INTEGER NOT NULL PRIMARY KEY,
      server_id        INTEGER NOT NULL REFERENCES servers(server_id),
      channel_kind_id  INTEGER NOT NULL REFERENCES channel_kinds(channel_kind_id),
      tag              TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  db.exec(`
    CREATE UNIQUE INDEX idx_timelines_identity
      ON timelines(server_id, channel_kind_id, COALESCE(tag, ''));
  `)

  // Step 3: timeline_items テーブル作成
  db.exec(`
    CREATE TABLE timeline_items (
      timeline_item_id      INTEGER NOT NULL PRIMARY KEY,
      timeline_id           INTEGER NOT NULL REFERENCES timelines(timeline_id) ON DELETE CASCADE,
      timeline_item_kind_id INTEGER NOT NULL REFERENCES timeline_item_kinds(timeline_item_kind_id),
      post_id               INTEGER REFERENCES posts(post_id) ON DELETE CASCADE,
      notification_id       INTEGER REFERENCES notifications(notification_id) ON DELETE CASCADE,
      sort_key              INTEGER NOT NULL,
      inserted_at           INTEGER NOT NULL
    );
  `)
  db.exec(
    'CREATE INDEX idx_timeline_items_timeline_sort ON timeline_items(timeline_id, sort_key DESC);',
  )
  db.exec(
    'CREATE UNIQUE INDEX idx_timeline_items_post ON timeline_items(timeline_id, post_id) WHERE post_id IS NOT NULL;',
  )
  db.exec(
    'CREATE UNIQUE INDEX idx_timeline_items_notification ON timeline_items(timeline_id, notification_id) WHERE notification_id IS NOT NULL;',
  )

  // Step 4: feed_events テーブル作成（アプリ層の統合は後日）
  db.exec(`
    CREATE TABLE feed_events (
      feed_event_id      INTEGER NOT NULL PRIMARY KEY,
      server_id          INTEGER NOT NULL REFERENCES servers(server_id),
      event_type         TEXT NOT NULL,
      post_id            INTEGER REFERENCES posts(post_id) ON DELETE CASCADE,
      notification_id    INTEGER REFERENCES notifications(notification_id) ON DELETE CASCADE,
      actor_profile_id   INTEGER REFERENCES profiles(profile_id),
      occurred_at        INTEGER NOT NULL,
      sort_key           INTEGER NOT NULL
    );
  `)
  db.exec(
    'CREATE INDEX idx_feed_events_server_sort ON feed_events(server_id, sort_key DESC);',
  )

  // Step 5: データ移行 — posts_timeline_types → timelines + timeline_items

  // 5a: 非タグの timelines を生成（server × channel_kind の DISTINCT 組み合わせ）
  db.exec(`
    INSERT OR IGNORE INTO timelines (server_id, channel_kind_id, tag, created_at)
    SELECT DISTINCT
      pb.server_id,
      ck.channel_kind_id,
      NULL,
      datetime('now')
    FROM posts_timeline_types ptt
    INNER JOIN posts_backends pb ON pb.post_id = ptt.post_id
    INNER JOIN channel_kinds ck ON ck.code = ptt.timelineType
    WHERE ptt.timelineType != 'tag';
  `)

  // 5b: タグ timelines を生成（server × 'tag' channel_kind × tag の DISTINCT 組み合わせ）
  db.exec(`
    INSERT OR IGNORE INTO timelines (server_id, channel_kind_id, tag, created_at)
    SELECT DISTINCT
      pb.server_id,
      ck.channel_kind_id,
      pbt.tag,
      datetime('now')
    FROM posts_belonging_tags pbt
    INNER JOIN posts_backends pb ON pb.post_id = pbt.post_id
    INNER JOIN channel_kinds ck ON ck.code = 'tag';
  `)

  // 5c: 非タグの timeline_items を生成
  db.exec(`
    INSERT OR IGNORE INTO timeline_items (timeline_id, timeline_item_kind_id, post_id, sort_key, inserted_at)
    SELECT
      t.timeline_id,
      (SELECT timeline_item_kind_id FROM timeline_item_kinds WHERE code = 'post'),
      ptt.post_id,
      p.created_at_ms,
      p.stored_at
    FROM posts_timeline_types ptt
    INNER JOIN posts p ON p.post_id = ptt.post_id
    INNER JOIN posts_backends pb ON pb.post_id = ptt.post_id
    INNER JOIN channel_kinds ck ON ck.code = ptt.timelineType
    INNER JOIN timelines t
      ON t.server_id = pb.server_id
      AND t.channel_kind_id = ck.channel_kind_id
      AND t.tag IS NULL
    WHERE ptt.timelineType != 'tag';
  `)

  // 5d: タグ timeline_items を生成
  db.exec(`
    INSERT OR IGNORE INTO timeline_items (timeline_id, timeline_item_kind_id, post_id, sort_key, inserted_at)
    SELECT
      t.timeline_id,
      (SELECT timeline_item_kind_id FROM timeline_item_kinds WHERE code = 'post'),
      pbt.post_id,
      p.created_at_ms,
      p.stored_at
    FROM posts_belonging_tags pbt
    INNER JOIN posts p ON p.post_id = pbt.post_id
    INNER JOIN posts_backends pb ON pb.post_id = pbt.post_id
    INNER JOIN channel_kinds ck ON ck.code = 'tag'
    INNER JOIN timelines t
      ON t.server_id = pb.server_id
      AND t.channel_kind_id = ck.channel_kind_id
      AND t.tag = pbt.tag;
  `)

  // Step 6: 旧テーブルを削除
  db.exec('DROP TABLE IF EXISTS posts_timeline_types;')
}

// ================================================================
// v15 → v16 マイグレーション（カスタム絵文字中間テーブル）
// ================================================================

/**
 * v15 → v16 マイグレーション
 *
 * post_custom_emojis テーブルを作成し、投稿とカスタム絵文字の関連を管理する。
 * usage_context で投稿本文の絵文字と表示名の絵文字を区別する。
 */
function migrateV15toV16(handle: DbHandle): void {
  const { db } = handle

  db.exec(`
    CREATE TABLE IF NOT EXISTS post_custom_emojis (
      post_id        INTEGER NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
      emoji_id       INTEGER NOT NULL REFERENCES custom_emojis(emoji_id),
      usage_context  TEXT NOT NULL,
      PRIMARY KEY (post_id, emoji_id, usage_context)
    );
  `)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_pce_post ON post_custom_emojis(post_id);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_pce_emoji ON post_custom_emojis(emoji_id);',
  )
}

/**
 * v16 → v17 マイグレーション
 *
 * follows テーブルを作成し、フォロー関係を管理する。
 */
function migrateV16toV17(handle: DbHandle): void {
  const { db } = handle

  db.exec(`
    CREATE TABLE IF NOT EXISTS follows (
      follow_id          INTEGER PRIMARY KEY,
      local_account_id   INTEGER NOT NULL,
      target_profile_id  INTEGER NOT NULL,
      created_at         TEXT,
      UNIQUE (local_account_id, target_profile_id),
      FOREIGN KEY (local_account_id) REFERENCES local_accounts(local_account_id) ON DELETE CASCADE,
      FOREIGN KEY (target_profile_id) REFERENCES profiles(profile_id) ON DELETE CASCADE
    );
  `)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_follows_identity ON follows(local_account_id, target_profile_id);',
  )
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_follows_target ON follows(target_profile_id);',
  )
}

/**
 * v17 → v18 マイグレーション
 / ================================================================
// v18 → v19 マイグレーション（timelines テーブルへのインデックス追加）
// ================================================================

/**
 * v18 → v19 マイグレーション
 *
 * timelines テーブルの channel_kind_id カラムにインデックスを追加し、
 * AUTOMATIC COVERING INDEX の生成を回避する。
 */
function migrateV18toV19(handle: DbHandle): void {
  const { db } = handle

  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_timelines_channel_kind ON timelines(channel_kind_id);',
  )
}

// ================================================================
// v19 → v20 マイグレーション: 通知→投稿結合用インデックス
// ================================================================

/**
 * v19 → v20 マイグレーション
 *
 * 混合クエリ（通知 + 投稿）で notifications → profiles → posts の結合を
 * 高速化するためのカバリングインデックスを追加する。
 */
function migrateV19toV20(handle: DbHandle): void {
  const { db } = handle

  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_notifications_type_actor ON notifications(notification_type_id, actor_profile_id, created_at_ms DESC);',
  )
}

// ================================================================
// v20 → v21 マイグレーション: post_engagements に emoji_text カラム追加
// ================================================================

/**
 * v20 → v21 マイグレーション
 *
 * post_engagements に emoji_text TEXT カラムを追加し、
 * Unicode 絵文字リアクションを保存できるようにする。
 * reaction 用ユニークインデックスを「投稿に1件」に再構築する。
 */
function migrateV20toV21(handle: DbHandle): void {
  const { db } = handle

  // post_engagements に emoji_text カラムを追加
  db.exec('ALTER TABLE post_engagements ADD COLUMN emoji_text TEXT;')

  // reaction 用ユニークインデックスを再構築
  // 「投稿に1件」なので reaction タイプは (account, post, type) で一意
  db.exec('DROP INDEX IF EXISTS idx_pe_unique_reaction;')
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pe_unique_reaction
    ON post_engagements(local_account_id, post_id, engagement_type_id)
    WHERE emoji_id IS NOT NULL OR emoji_text IS NOT NULL;
  `)
}

// ================================================================
// v21 → v22 マイグレーション: post_stats に emoji_reactions_json カラム追加
// ================================================================

/**
 * v21 → v22 マイグレーション
 *
 * post_stats に emoji_reactions_json TEXT カラムを追加し、
 * 投稿の絵文字リアクション情報（Pleroma/Firefish の emoji_reactions）を
 * JSON 形式で保存できるようにする。
 */
function migrateV21toV22(handle: DbHandle): void {
  const { db } = handle

  db.exec('ALTER TABLE post_stats ADD COLUMN emoji_reactions_json TEXT;')
}

/*
 * profile_custom_emojis テーブルを作成し、プロフィール（通知アクター等）に
 * カスタム絵文字を紐付けられるようにする。
 */
function migrateV17toV18(handle: DbHandle): void {
  const { db } = handle

  db.exec(`
    CREATE TABLE IF NOT EXISTS profile_custom_emojis (
      profile_id     INTEGER NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
      emoji_id       INTEGER NOT NULL REFERENCES custom_emojis(emoji_id) ON DELETE CASCADE,
      PRIMARY KEY (profile_id, emoji_id)
    );
  `)
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_profile_emojis_profile ON profile_custom_emojis(profile_id);',
  )
}

/**
 * v5 スキーマのフル作成
 *
 * v4 に加え、リブログ関係を管理する statuses_reblogs テーブルを含む。
 */
function _createSchemaV5(handle: DbHandle): void {
  // v4 までのスキーマを作成
  _createSchemaV4(handle)

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
function _createSchemaV4(handle: DbHandle): void {
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
