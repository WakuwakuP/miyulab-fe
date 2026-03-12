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
const SCHEMA_VERSION = 8

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
      // フレッシュインストール: v8 スキーマを直接作成
      createSchemaV8(handle)
    } else if (currentVersion < 2) {
      migrateV1toV2(handle)
      migrateV2toV3(handle)
      migrateV3toV4(handle)
      migrateV4toV5(handle)
      migrateV5toV6(handle)
      migrateV6toV7(handle)
      migrateV7toV8(handle)
    } else if (currentVersion < 3) {
      migrateV2toV3(handle)
      migrateV3toV4(handle)
      migrateV4toV5(handle)
      migrateV5toV6(handle)
      migrateV6toV7(handle)
      migrateV7toV8(handle)
    } else if (currentVersion < 4) {
      migrateV3toV4(handle)
      migrateV4toV5(handle)
      migrateV5toV6(handle)
      migrateV6toV7(handle)
      migrateV7toV8(handle)
    } else if (currentVersion < 5) {
      migrateV4toV5(handle)
      migrateV5toV6(handle)
      migrateV6toV7(handle)
      migrateV7toV8(handle)
    } else if (currentVersion < 6) {
      migrateV5toV6(handle)
      migrateV6toV7(handle)
      migrateV7toV8(handle)
    } else if (currentVersion < 7) {
      migrateV6toV7(handle)
      migrateV7toV8(handle)
    } else if (currentVersion < 8) {
      migrateV7toV8(handle)
    }

    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`)
    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }
}

// ================================================================
// v8 フルスキーマ作成（フレッシュインストール用）
// ================================================================

/**
 * v8 スキーマのフル作成（フレッシュインストール用）
 *
 * v7 スキーマ + マスターテーブル群 + server_id / visibility_id / notification_type_id カラム。
 */
function createSchemaV8(handle: DbHandle): void {
  // v7 ベーススキーマを作成
  createSchemaV7(handle)
  // v8 マスターテーブル + 新カラムを追加
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
// v5 スキーマ作成（v6 から内部呼び出し）
// ================================================================

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
