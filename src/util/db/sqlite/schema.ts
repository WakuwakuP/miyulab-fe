/**
 * SQLite スキーマ定義 (v27)
 *
 * 最新バージョン以外の DB はすべてリセット（全テーブル DROP → 再作成）する。
 * 段階的マイグレーションは廃止。キャッシュ DB のためデータロスは許容される。
 *
 * テーブル一覧 (35 tables):
 * - posts                   投稿
 * - posts_mentions           メンション（多対多）
 * - posts_backends           投稿 × バックエンド（多対多, PK: server_id, local_id）
 * - posts_reblogs            リブログ関係
 * - muted_accounts           ミュートアカウント（PK: server_id, account_acct）
 * - blocked_instances         ブロックインスタンス
 * - notifications            通知
 * - software_types           ソフトウェア種別マスタ
 * - servers                  サーバーマスタ
 * - visibility_types         可視性マスタ
 * - notification_types       通知タイプマスタ
 * - media_types              メディアタイプマスタ
 * - engagement_types         エンゲージメントタイプマスタ
 * - channel_kinds            チャンネル種別マスタ
 * - timeline_item_kinds      タイムラインアイテム種別マスタ
 * - profiles                 プロファイル
 * - profile_aliases          プロファイルエイリアス
 * - profile_fields           プロファイルフィールド
 * - local_accounts           ローカルアカウント
 * - post_media               投稿メディア
 * - hashtags                 ハッシュタグマスタ
 * - post_hashtags            投稿×ハッシュタグ（多対多）
 * - post_stats               投稿統計
 * - custom_emojis            カスタム絵文字
 * - polls                    投票
 * - poll_options             投票選択肢
 * - link_cards               リンクカード
 * - post_links               投稿×リンクカード
 * - post_engagements         エンゲージメント
 * - timelines                タイムライン
 * - timeline_items           タイムラインアイテム
 * - feed_events              フィードイベント
 * - post_custom_emojis       投稿×カスタム絵文字
 * - follows                  フォロー関係
 * - profile_custom_emojis    プロファイル×カスタム絵文字
 */

import type { SchemaDbHandle as DbHandle } from './worker/workerSchema'

/** 現在のスキーマバージョン */
const SCHEMA_VERSION = 27

/**
 * スキーマの初期化
 *
 * user_version PRAGMA を用いてバージョン管理する。
 * 現在のバージョンと一致しない場合は全テーブルを DROP して再作成する。
 */
export function ensureSchema(handle: DbHandle): void {
  const { db } = handle

  const currentVersion = (
    db.exec('PRAGMA user_version;', { returnValue: 'resultRows' }) as number[][]
  )[0][0]

  if (currentVersion === SCHEMA_VERSION) return

  db.exec('BEGIN;')
  try {
    if (currentVersion > 0) {
      // 既存 DB だがバージョンが異なる → 全テーブル DROP してリセット
      dropAllTables(handle)
    }

    createFreshSchema(handle)

    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`)
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }
  db.exec('COMMIT;')
}

// ================================================================
// 全テーブル DROP
// ================================================================

/**
 * DB 内の全ユーザーテーブル・インデックス・トリガーを削除する
 */
function dropAllTables(handle: DbHandle): void {
  const { db } = handle

  // トリガー削除
  const triggers = db.exec(
    "SELECT name FROM sqlite_master WHERE type = 'trigger';",
    { returnValue: 'resultRows' },
  ) as string[][]
  for (const [name] of triggers) {
    db.exec(`DROP TRIGGER IF EXISTS ${name};`)
  }

  // ビュー削除
  const views = db.exec("SELECT name FROM sqlite_master WHERE type = 'view';", {
    returnValue: 'resultRows',
  }) as string[][]
  for (const [name] of views) {
    db.exec(`DROP VIEW IF EXISTS ${name};`)
  }

  // テーブル削除（sqlite_ 内部テーブルを除く）
  const tables = db.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';",
    { returnValue: 'resultRows' },
  ) as string[][]
  for (const [name] of tables) {
    db.exec(`DROP TABLE IF EXISTS ${name};`)
  }
}

// ================================================================
// v27 フルスキーマ作成（フレッシュインストール用）
// ================================================================

/**
 * v27 スキーマの完全作成
 *
 * 全テーブル・インデックス・シードデータを一括作成する。
 */
function createFreshSchema(handle: DbHandle): void {
  createMasterTables(handle)
  createCoreTables(handle)
  createProfileTables(handle)
  createPostNormalizationTables(handle)
  createEngagementsTable(handle)
  createTimelineTables(handle)
  createAdditionalTables(handle)
}

// ================================================================
// マスターテーブル群
// ================================================================

function createMasterTables(handle: DbHandle): void {
  const { db } = handle

  // software_types
  db.exec(`
    CREATE TABLE software_types (
      software_type_id  INTEGER PRIMARY KEY,
      code              TEXT NOT NULL UNIQUE,
      display_name      TEXT NOT NULL
    );
  `)
  db.exec(`
    INSERT INTO software_types (code, display_name) VALUES
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
    CREATE TABLE servers (
      server_id         INTEGER PRIMARY KEY,
      host              TEXT NOT NULL UNIQUE,
      base_url          TEXT NOT NULL,
      software_type_id  INTEGER,
      software_version  TEXT,
      detected_at       TEXT,
      FOREIGN KEY (software_type_id) REFERENCES software_types(software_type_id)
    );
  `)
  db.exec('CREATE INDEX idx_servers_host ON servers(host);')

  // visibility_types
  db.exec(`
    CREATE TABLE visibility_types (
      visibility_id  INTEGER PRIMARY KEY,
      code           TEXT NOT NULL UNIQUE,
      display_name   TEXT NOT NULL
    );
  `)
  db.exec(`
    INSERT INTO visibility_types (code, display_name) VALUES
      ('public', '公開'),
      ('unlisted', '未収載'),
      ('private', 'フォロワー限定'),
      ('direct', 'ダイレクト');
  `)

  // notification_types
  db.exec(`
    CREATE TABLE notification_types (
      notification_type_id  INTEGER PRIMARY KEY,
      code                  TEXT NOT NULL UNIQUE,
      display_name          TEXT NOT NULL
    );
  `)
  db.exec(`
    INSERT INTO notification_types (code, display_name) VALUES
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
    CREATE TABLE media_types (
      media_type_id  INTEGER PRIMARY KEY,
      code           TEXT NOT NULL UNIQUE,
      display_name   TEXT NOT NULL
    );
  `)
  db.exec(`
    INSERT INTO media_types (code, display_name) VALUES
      ('image', '画像'),
      ('video', '動画'),
      ('gifv', 'GIF動画'),
      ('audio', '音声'),
      ('unknown', '不明');
  `)

  // engagement_types
  db.exec(`
    CREATE TABLE engagement_types (
      engagement_type_id  INTEGER PRIMARY KEY,
      code                TEXT NOT NULL UNIQUE,
      display_name        TEXT NOT NULL
    );
  `)
  db.exec(`
    INSERT INTO engagement_types (code, display_name) VALUES
      ('favourite', 'お気に入り'),
      ('reblog', 'ブースト'),
      ('bookmark', 'ブックマーク'),
      ('reaction', 'リアクション');
  `)

  // channel_kinds
  db.exec(`
    CREATE TABLE channel_kinds (
      channel_kind_id  INTEGER PRIMARY KEY,
      code             TEXT NOT NULL UNIQUE,
      display_name     TEXT NOT NULL
    );
  `)
  db.exec(`
    INSERT INTO channel_kinds (code, display_name) VALUES
      ('home', 'ホーム'),
      ('local', 'ローカル'),
      ('federated', '連合'),
      ('tag', 'タグ'),
      ('notification', '通知'),
      ('bookmark', 'ブックマーク'),
      ('conversation', 'DM'),
      ('public', '連合（パブリック）');
  `)

  // timeline_item_kinds
  db.exec(`
    CREATE TABLE timeline_item_kinds (
      timeline_item_kind_id  INTEGER PRIMARY KEY,
      code                   TEXT NOT NULL UNIQUE,
      display_name           TEXT NOT NULL
    );
  `)
  db.exec(`
    INSERT INTO timeline_item_kinds (code, display_name) VALUES
      ('post', '投稿'),
      ('notification', '通知'),
      ('event', 'イベント');
  `)
}

// ================================================================
// コアテーブル（posts / notifications / muted / blocked）
// ================================================================

function createCoreTables(handle: DbHandle): void {
  const { db } = handle

  // ============================================
  // posts (v13 shape)
  // ============================================
  db.exec(`
    CREATE TABLE posts (
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
    'CREATE INDEX idx_posts_reblog_dedup ON posts(reblog_of_uri, author_profile_id) WHERE is_reblog = 1 AND reblog_of_uri IS NOT NULL;',
  )

  // ============================================
  // posts_mentions
  // ============================================
  db.exec(`
    CREATE TABLE posts_mentions (
      post_id  INTEGER NOT NULL,
      acct     TEXT NOT NULL,
      PRIMARY KEY (post_id, acct),
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
    );
  `)
  db.exec('CREATE INDEX idx_pm_acct ON posts_mentions(acct);')

  // ============================================
  // posts_backends (v27 shape: PK = server_id, local_id)
  // ============================================
  db.exec(`
    CREATE TABLE posts_backends (
      server_id  INTEGER NOT NULL,
      local_id   TEXT    NOT NULL,
      post_id    INTEGER NOT NULL,
      backendUrl TEXT,
      PRIMARY KEY (server_id, local_id),
      FOREIGN KEY (post_id)   REFERENCES posts(post_id) ON DELETE CASCADE,
      FOREIGN KEY (server_id) REFERENCES servers(server_id)
    );
  `)
  db.exec('CREATE INDEX idx_pb_post_id ON posts_backends(post_id);')
  db.exec(
    'CREATE INDEX idx_pb_server_key ON posts_backends(server_id, post_id);',
  )
  db.exec('CREATE INDEX idx_pb_server_id ON posts_backends(server_id);')

  // ============================================
  // posts_reblogs
  // ============================================
  db.exec(`
    CREATE TABLE posts_reblogs (
      post_id         INTEGER NOT NULL,
      original_uri    TEXT NOT NULL DEFAULT '',
      reblogger_acct  TEXT NOT NULL DEFAULT '',
      reblogged_at_ms INTEGER NOT NULL,
      PRIMARY KEY (post_id, reblogger_acct),
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
    );
  `)
  db.exec('CREATE INDEX idx_pr_original_uri ON posts_reblogs(original_uri);')
  db.exec(
    'CREATE INDEX idx_pr_reblogger_acct ON posts_reblogs(reblogger_acct);',
  )

  // ============================================
  // muted_accounts (v27 shape: PK = server_id, account_acct)
  // ============================================
  db.exec(`
    CREATE TABLE muted_accounts (
      server_id    INTEGER NOT NULL,
      account_acct TEXT    NOT NULL,
      muted_at     INTEGER NOT NULL,
      PRIMARY KEY (server_id, account_acct),
      FOREIGN KEY (server_id) REFERENCES servers(server_id)
    );
  `)
  db.exec('CREATE INDEX idx_muted_server ON muted_accounts(server_id);')

  // ============================================
  // blocked_instances
  // ============================================
  db.exec(`
    CREATE TABLE blocked_instances (
      instance_domain TEXT PRIMARY KEY,
      blocked_at      INTEGER NOT NULL
    );
  `)

  // ============================================
  // notifications (v13 shape + v24 ALTERs)
  // ============================================
  db.exec(`
    CREATE TABLE notifications (
      notification_id      INTEGER PRIMARY KEY,
      server_id            INTEGER,
      local_id             TEXT NOT NULL DEFAULT '',
      notification_type_id INTEGER,
      actor_profile_id     INTEGER,
      related_post_id      INTEGER,
      created_at_ms        INTEGER NOT NULL,
      stored_at            INTEGER NOT NULL,
      is_read              INTEGER NOT NULL DEFAULT 0,
      reaction_name        TEXT,
      reaction_url         TEXT,
      FOREIGN KEY (server_id) REFERENCES servers(server_id),
      FOREIGN KEY (notification_type_id) REFERENCES notification_types(notification_type_id),
      FOREIGN KEY (actor_profile_id) REFERENCES profiles(profile_id),
      FOREIGN KEY (related_post_id) REFERENCES posts(post_id)
    );
  `)
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
// プロファイルテーブル群
// ================================================================

function createProfileTables(handle: DbHandle): void {
  const { db } = handle

  // profiles
  db.exec(`
    CREATE TABLE profiles (
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
  db.exec('CREATE INDEX idx_profiles_acct ON profiles(acct);')
  db.exec(
    'CREATE INDEX idx_profiles_server ON profiles(home_server_id, profile_id);',
  )
  db.exec('CREATE INDEX idx_profiles_username ON profiles(username);')

  // profile_aliases
  db.exec(`
    CREATE TABLE profile_aliases (
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
  db.exec('CREATE INDEX idx_pa_profile ON profile_aliases(profile_id);')

  // profile_fields
  db.exec(`
    CREATE TABLE profile_fields (
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
    CREATE TABLE local_accounts (
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
// 投稿データ正規化テーブル群
// ================================================================

function createPostNormalizationTables(handle: DbHandle): void {
  const { db } = handle

  // post_media
  db.exec(`
    CREATE TABLE post_media (
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
  db.exec('CREATE INDEX idx_post_media_post ON post_media(post_id);')
  db.exec('CREATE INDEX idx_post_media_type ON post_media(media_type_id);')

  // hashtags
  db.exec(`
    CREATE TABLE hashtags (
      hashtag_id      INTEGER PRIMARY KEY,
      normalized_name TEXT NOT NULL UNIQUE,
      display_name    TEXT NOT NULL
    );
  `)

  // post_hashtags
  db.exec(`
    CREATE TABLE post_hashtags (
      post_id    INTEGER NOT NULL,
      hashtag_id INTEGER NOT NULL,
      sort_order INTEGER,
      PRIMARY KEY (post_id, hashtag_id),
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE,
      FOREIGN KEY (hashtag_id) REFERENCES hashtags(hashtag_id)
    );
  `)
  db.exec('CREATE INDEX idx_ph_hashtag ON post_hashtags(hashtag_id, post_id);')

  // post_stats (v10 + v22 emoji_reactions_json)
  db.exec(`
    CREATE TABLE post_stats (
      post_id              INTEGER PRIMARY KEY,
      replies_count        INTEGER,
      reblogs_count        INTEGER,
      favourites_count     INTEGER,
      reactions_count      INTEGER,
      quotes_count         INTEGER,
      fetched_at           TEXT NOT NULL,
      emoji_reactions_json TEXT,
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
    );
  `)
  db.exec(
    'CREATE INDEX idx_ps_favourites ON post_stats(favourites_count, post_id);',
  )
  db.exec('CREATE INDEX idx_ps_reblogs ON post_stats(reblogs_count, post_id);')

  // custom_emojis
  db.exec(`
    CREATE TABLE custom_emojis (
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

  // polls
  db.exec(`
    CREATE TABLE polls (
      poll_id       INTEGER PRIMARY KEY,
      post_id       INTEGER NOT NULL UNIQUE,
      expires_at    TEXT,
      multiple      INTEGER NOT NULL DEFAULT 0,
      votes_count   INTEGER,
      voters_count  INTEGER,
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE
    );
  `)

  // poll_options
  db.exec(`
    CREATE TABLE poll_options (
      poll_option_id  INTEGER PRIMARY KEY,
      poll_id         INTEGER NOT NULL,
      option_index    INTEGER NOT NULL,
      title           TEXT NOT NULL,
      votes_count     INTEGER,
      UNIQUE (poll_id, option_index),
      FOREIGN KEY (poll_id) REFERENCES polls(poll_id) ON DELETE CASCADE
    );
  `)

  // link_cards
  db.exec(`
    CREATE TABLE link_cards (
      link_card_id  INTEGER PRIMARY KEY,
      canonical_url TEXT NOT NULL UNIQUE,
      title         TEXT,
      description   TEXT,
      image_url     TEXT,
      provider_name TEXT,
      fetched_at    TEXT NOT NULL
    );
  `)

  // post_links
  db.exec(`
    CREATE TABLE post_links (
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
// エンゲージメントテーブル
// ================================================================

function createEngagementsTable(handle: DbHandle): void {
  const { db } = handle

  db.exec(`
    CREATE TABLE post_engagements (
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
  db.exec(
    'CREATE UNIQUE INDEX idx_pe_unique ON post_engagements(local_account_id, post_id, engagement_type_id) WHERE emoji_id IS NULL AND emoji_text IS NULL;',
  )
  db.exec(
    'CREATE UNIQUE INDEX idx_pe_unique_reaction ON post_engagements(local_account_id, post_id, engagement_type_id) WHERE emoji_id IS NOT NULL OR emoji_text IS NOT NULL;',
  )
  db.exec(
    'CREATE INDEX idx_pe_account_type ON post_engagements(local_account_id, engagement_type_id, created_at DESC);',
  )
  db.exec('CREATE INDEX idx_pe_post ON post_engagements(post_id);')
}

// ================================================================
// タイムラインテーブル群
// ================================================================

function createTimelineTables(handle: DbHandle): void {
  const { db } = handle

  // timelines
  db.exec(`
    CREATE TABLE timelines (
      timeline_id      INTEGER NOT NULL PRIMARY KEY,
      server_id        INTEGER NOT NULL REFERENCES servers(server_id),
      channel_kind_id  INTEGER NOT NULL REFERENCES channel_kinds(channel_kind_id),
      tag              TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  db.exec(
    "CREATE UNIQUE INDEX idx_timelines_identity ON timelines(server_id, channel_kind_id, COALESCE(tag, ''));",
  )
  db.exec(
    'CREATE INDEX idx_timelines_channel_kind ON timelines(channel_kind_id);',
  )

  // timeline_items
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
  db.exec(
    'CREATE INDEX idx_timeline_items_post_id ON timeline_items(post_id) WHERE post_id IS NOT NULL;',
  )

  // feed_events
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
}

// ================================================================
// 追加テーブル（post_custom_emojis / follows / profile_custom_emojis）
// ================================================================

function createAdditionalTables(handle: DbHandle): void {
  const { db } = handle

  // post_custom_emojis (v16)
  db.exec(`
    CREATE TABLE post_custom_emojis (
      post_id        INTEGER NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
      emoji_id       INTEGER NOT NULL REFERENCES custom_emojis(emoji_id),
      usage_context  TEXT NOT NULL,
      PRIMARY KEY (post_id, emoji_id, usage_context)
    );
  `)
  db.exec('CREATE INDEX idx_pce_post ON post_custom_emojis(post_id);')
  db.exec('CREATE INDEX idx_pce_emoji ON post_custom_emojis(emoji_id);')

  // follows (v17)
  db.exec(`
    CREATE TABLE follows (
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
    'CREATE INDEX idx_follows_identity ON follows(local_account_id, target_profile_id);',
  )
  db.exec('CREATE INDEX idx_follows_target ON follows(target_profile_id);')

  // profile_custom_emojis (v18)
  db.exec(`
    CREATE TABLE profile_custom_emojis (
      profile_id     INTEGER NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
      emoji_id       INTEGER NOT NULL REFERENCES custom_emojis(emoji_id) ON DELETE CASCADE,
      PRIMARY KEY (profile_id, emoji_id)
    );
  `)
  db.exec(
    'CREATE INDEX idx_profile_emojis_profile ON profile_custom_emojis(profile_id);',
  )
}
