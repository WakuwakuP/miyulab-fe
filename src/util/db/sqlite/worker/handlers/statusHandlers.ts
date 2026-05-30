/**
 * Status 関連のハンドラ群
 *
 * 新スキーマ (v2) 対応版:
 *   - posts PK: post_id → id
 *   - posts カラム: stored_at/has_media/media_count/has_spoiler/reblog_of_uri 削除
 *   - 新カラム: last_fetched_at/edited_at_ms/plain_content/in_reply_to_account_acct/
 *     reblog_of_post_id/quote_of_post_id/quote_state/application_name
 *   - posts_backends → post_backend_ids (local_account_id 必須)
 *   - timeline_items → timeline_entries (buildTimelineKey 使用)
 *   - posts_reblogs テーブル廃止
 *   - ensureProfileAlias 削除
 *   - toggleEngagement → updateInteraction
 *   - extractStatusColumns → extractPostColumns
 *   - ensureServer(db, host) / ensureProfile(db, account, serverId)
 *   - resolveDelayedReplyReferences / resolveDelayedRepostReferences 削除
 *   - cachedPostItemKindId / setCachedPostItemKindId 削除
 */

import type { Entity } from 'megalodon'
import {
  buildTimelineKey,
  ensureProfile,
  ensureServer,
  extractPostColumns,
  type PostColumns,
  resolveEmojisFromDb,
  resolveLocalAccountId,
  syncLinkCard,
  syncPollData,
  syncPostCustomEmojis,
  syncPostHashtags,
  syncProfileCustomEmojis,
  updateInteraction,
} from '../../helpers'
import {
  ensureReblogOriginalPost,
  syncPostMedia,
  syncPostStats,
  upsertMentionsInternal,
} from './postSync'
import {
  deriveAccountDomain,
  getLastInsertRowId,
  resolvePostIdInternal,
  resolveRepostOfPostId,
  resolveVisibilityId,
} from './statusHelpers'
import type { DbExec, HandlerResult, WrittenTableCollector } from './types'

// ================================================================
// 内部ヘルパー: エンゲージメント同期
// ================================================================

/**
 * サーバーから返されたフラグをDBに反映する。
 * === true で設定、=== false で解除、null/undefined はスキップ（データなし）。
 */
function syncInteractions(
  db: DbExec,
  postId: number,
  localAccountId: number,
  status: Entity.Status,
  collector?: WrittenTableCollector,
): void {
  if (status.favourited === true) {
    updateInteraction(db, postId, localAccountId, 'favourite', true, collector)
  } else if (status.favourited === false) {
    updateInteraction(db, postId, localAccountId, 'favourite', false, collector)
  }
  if (status.reblogged === true) {
    updateInteraction(db, postId, localAccountId, 'reblog', true, collector)
  } else if (status.reblogged === false) {
    updateInteraction(db, postId, localAccountId, 'reblog', false, collector)
  }
  if (status.bookmarked === true) {
    updateInteraction(db, postId, localAccountId, 'bookmark', true, collector)
  } else if (status.bookmarked === false) {
    updateInteraction(db, postId, localAccountId, 'bookmark', false, collector)
  }
}

type ExistingPostLookup = {
  postId: number | undefined
  existingIsOriginal: boolean
  foundViaReblogDedup: boolean
}

function syncProfileEmojisForStatus(
  db: DbExec,
  profileId: number,
  serverId: number,
  status: Entity.Status,
  accountDomain: string,
  skipProfileUpdate?: boolean,
  collector?: WrittenTableCollector,
): void {
  if (skipProfileUpdate) return
  const acctEmojis =
    status.account.emojis.length > 0
      ? status.account.emojis
      : resolveEmojisFromDb(
          db,
          serverId,
          status.account.display_name,
          accountDomain,
        )
  if (acctEmojis.length > 0) {
    syncProfileCustomEmojis(db, profileId, serverId, acctEmojis, collector)
  }
}

function resolveExistingPostLookup(
  db: DbExec,
  status: Entity.Status,
  normalizedUri: string,
  isReblog: number,
  reblogOfUri: string | null,
  localAccountId: number | null,
  uriCache?: Map<string, number>,
): ExistingPostLookup {
  let postId: number | undefined = normalizedUri
    ? uriCache?.get(normalizedUri)
    : undefined
  let existingIsOriginal = false
  let foundViaReblogDedup = false

  if (postId === undefined && normalizedUri) {
    const existingRows = db.exec(
      'SELECT id, is_reblog FROM posts WHERE object_uri = ?;',
      { bind: [normalizedUri], returnValue: 'resultRows' },
    ) as number[][]
    if (existingRows.length > 0) {
      if (isReblog === 1 && existingRows[0][1] === 0) {
        existingIsOriginal = true
      } else {
        postId = existingRows[0][0]
      }
    }
  }

  if (postId === undefined && !existingIsOriginal && localAccountId !== null) {
    postId = resolvePostIdInternal(db, localAccountId, status.id) ?? undefined
  }

  if (
    postId === undefined &&
    !existingIsOriginal &&
    isReblog === 1 &&
    normalizedUri !== '' &&
    normalizedUri === reblogOfUri
  ) {
    existingIsOriginal = true
  }

  if (postId === undefined && isReblog === 1 && reblogOfUri) {
    const rebloggerDomain = deriveAccountDomain(status.account)
    if (rebloggerDomain) {
      const existingReblog = db.exec(
        `SELECT p.id FROM posts p
         JOIN profiles pr ON pr.id = p.author_profile_id
         JOIN servers s ON s.id = pr.server_id
         JOIN posts orig ON orig.id = p.reblog_of_post_id
         WHERE p.is_reblog = 1
           AND orig.object_uri = ?
           AND pr.username = ?
           AND (s.host = ? OR pr.actor_uri LIKE ?)
         LIMIT 1;`,
        {
          bind: [
            reblogOfUri,
            status.account.username,
            rebloggerDomain,
            `https://${rebloggerDomain}/%`,
          ],
          returnValue: 'resultRows',
        },
      ) as number[][]
      if (existingReblog.length > 0) {
        postId = existingReblog[0][0]
        existingIsOriginal = false
        foundViaReblogDedup = true
      }
    }
  }

  return { existingIsOriginal, foundViaReblogDedup, postId }
}

function updateExistingPostRow(
  db: DbExec,
  postId: number,
  now: number,
  visibilityId: number | null,
  cols: PostColumns,
  isReblog: number,
  reblogOfPostId: number | null,
): void {
  db.exec(
    `UPDATE posts SET
      last_fetched_at        = ?,
      visibility_id          = ?,
      language               = ?,
      content_html           = ?,
      spoiler_text           = ?,
      canonical_url          = ?,
      is_reblog              = ?,
      is_sensitive           = ?,
      in_reply_to_uri        = ?,
      in_reply_to_account_acct = ?,
      edited_at_ms           = ?,
      plain_content          = ?,
      quote_state            = ?,
      is_local_only          = ?,
      application_name       = ?,
      reblog_of_post_id      = ?,
      quote_of_post_id       = ?
    WHERE id = ?;`,
    {
      bind: [
        now,
        visibilityId ?? cols.visibility_id,
        cols.language,
        cols.content_html,
        cols.spoiler_text,
        cols.canonical_url,
        isReblog,
        cols.is_sensitive,
        cols.in_reply_to_uri,
        cols.in_reply_to_account_acct,
        cols.edited_at_ms,
        cols.plain_content,
        cols.quote_state,
        cols.is_local_only,
        cols.application_name,
        reblogOfPostId,
        null,
        postId,
      ],
    },
  )
}

function insertNewPostRow(
  db: DbExec,
  existingIsOriginal: boolean,
  normalizedUri: string,
  serverId: number,
  now: number,
  profileId: number,
  visibilityId: number | null,
  cols: PostColumns,
  isReblog: number,
  reblogOfPostId: number | null,
): number {
  const insertUri = existingIsOriginal ? '' : normalizedUri
  db.exec(
    `INSERT INTO posts (
      object_uri, origin_server_id, created_at_ms, last_fetched_at,
      author_profile_id, visibility_id, language,
      content_html, spoiler_text, canonical_url,
      is_reblog, is_sensitive,
      in_reply_to_uri, in_reply_to_account_acct,
      is_local_only, edited_at_ms,
      plain_content, quote_state, application_name,
      reblog_of_post_id, quote_of_post_id
    ) VALUES (?,?,?,?, ?,?,?, ?,?,?, ?,?, ?,?, ?,?, ?,?,?, ?,?);`,
    {
      bind: [
        insertUri,
        serverId,
        cols.created_at_ms,
        now,
        profileId,
        visibilityId ?? cols.visibility_id,
        cols.language,
        cols.content_html,
        cols.spoiler_text,
        cols.canonical_url,
        isReblog,
        cols.is_sensitive,
        cols.in_reply_to_uri,
        cols.in_reply_to_account_acct,
        cols.is_local_only,
        cols.edited_at_ms,
        cols.plain_content,
        cols.quote_state,
        cols.application_name,
        reblogOfPostId,
        null,
      ],
    },
  )
  return getLastInsertRowId(db)
}

function updatePostUriCache(
  db: DbExec,
  uriCache: Map<string, number> | undefined,
  normalizedUri: string,
  postId: number,
  isReblog: number,
  reblogOfUri: string | null,
  foundViaReblogDedup: boolean,
): void {
  if (foundViaReblogDedup && normalizedUri && normalizedUri !== reblogOfUri) {
    db.exec(
      `UPDATE posts SET object_uri = ? WHERE id = ? AND object_uri = '';`,
      { bind: [normalizedUri, postId] },
    )
    uriCache?.set(normalizedUri, postId)
  }

  if (
    uriCache &&
    normalizedUri &&
    !(isReblog === 1 && normalizedUri === reblogOfUri)
  ) {
    uriCache.set(normalizedUri, postId)
  }
}

function registerPostBackendAndTimeline(
  db: DbExec,
  postId: number,
  status: Entity.Status,
  serverId: number,
  localAccountId: number,
  timelineKey: string,
  isReblog: number,
  reblogOfPostId: number | null,
  createdAtMs: number,
  collector?: WrittenTableCollector,
): void {
  db.exec(
    `INSERT OR IGNORE INTO post_backend_ids (post_id, local_account_id, local_id, server_id)
     VALUES (?, ?, ?, ?);`,
    { bind: [postId, localAccountId, status.id, serverId] },
  )
  collector?.add('post_backend_ids')

  const displayPostId = isReblog === 1 ? reblogOfPostId : null
  db.exec(
    `INSERT OR IGNORE INTO timeline_entries (local_account_id, timeline_key, post_id, display_post_id, created_at_ms)
     VALUES (?, ?, ?, ?, ?);`,
    {
      bind: [localAccountId, timelineKey, postId, displayPostId, createdAtMs],
    },
  )
  collector?.add('timeline_entries')
}

function syncPostRelatedData(
  db: DbExec,
  postId: number,
  status: Entity.Status,
  serverId: number,
  localAccountId: number | null,
  accountDomain: string,
  collector?: WrittenTableCollector,
): void {
  upsertMentionsInternal(db, postId, status.mentions, collector)
  syncPostMedia(db, postId, status.media_attachments, collector)
  syncPostStats(db, postId, status, collector)

  if (localAccountId !== null) {
    syncInteractions(db, postId, localAccountId, status, collector)
  }

  const statusEmojisResolved =
    status.emojis?.length > 0
      ? status.emojis
      : resolveEmojisFromDb(
          db,
          serverId,
          status.plain_content ?? null,
          accountDomain,
        )
  const accountEmojisResolved =
    status.account?.emojis?.length > 0
      ? status.account.emojis
      : resolveEmojisFromDb(
          db,
          serverId,
          status.account?.display_name ?? null,
          accountDomain,
        )
  syncPostCustomEmojis(
    db,
    postId,
    serverId,
    [...statusEmojisResolved, ...accountEmojisResolved],
    collector,
  )
  syncPostHashtags(db, postId, status.tags, collector)
  syncPollData(db, postId, status.poll, collector)
  syncLinkCard(db, postId, status.card, collector)
}

// ================================================================
// 内部ヘルパー: 投稿の UPSERT コアロジック
// ================================================================

/**
 * 単一投稿の UPSERT 処理。
 * handleUpsertStatus / handleBulkUpsertStatuses の共通ロジック。
 *
 * @returns 保存された postId
 */
function upsertSingleStatus(
  db: DbExec,
  status: Entity.Status,
  serverId: number,
  localAccountId: number | null,
  now: number,
  timelineKey: string,
  uriCache?: Map<string, number>,
  collector?: WrittenTableCollector,
  skipProfileUpdate?: boolean,
): number {
  const normalizedUri = status.uri?.trim() || ''
  const cols = extractPostColumns(status)
  const visibilityId = resolveVisibilityId(db, cols.visibility_id.toString())
  const profileId = ensureProfile(
    db,
    status.account,
    serverId,
    collector,
    skipProfileUpdate,
  )
  const accountDomain = deriveAccountDomain(status.account)

  syncProfileEmojisForStatus(
    db,
    profileId,
    serverId,
    status,
    accountDomain,
    skipProfileUpdate,
    collector,
  )

  const isReblog = status.reblog != null ? 1 : 0
  const reblogOfUri = status.reblog?.uri ?? null

  if (isReblog === 1 && status.reblog) {
    ensureReblogOriginalPost(
      db,
      status.reblog,
      '',
      serverId,
      now,
      localAccountId,
      collector,
      skipProfileUpdate,
    )
  }

  const {
    postId: existingPostId,
    existingIsOriginal,
    foundViaReblogDedup,
  } = resolveExistingPostLookup(
    db,
    status,
    normalizedUri,
    isReblog,
    reblogOfUri,
    localAccountId,
    uriCache,
  )

  const reblogOfPostId =
    isReblog === 1 ? resolveRepostOfPostId(db, reblogOfUri) : null

  let postId: number
  if (existingPostId !== undefined) {
    updateExistingPostRow(
      db,
      existingPostId,
      now,
      visibilityId,
      cols,
      isReblog,
      reblogOfPostId,
    )
    postId = existingPostId
  } else {
    postId = insertNewPostRow(
      db,
      existingIsOriginal,
      normalizedUri,
      serverId,
      now,
      profileId,
      visibilityId,
      cols,
      isReblog,
      reblogOfPostId,
    )
  }
  collector?.add('posts')

  updatePostUriCache(
    db,
    uriCache,
    normalizedUri,
    postId,
    isReblog,
    reblogOfUri,
    foundViaReblogDedup,
  )

  if (localAccountId !== null) {
    registerPostBackendAndTimeline(
      db,
      postId,
      status,
      serverId,
      localAccountId,
      timelineKey,
      isReblog,
      reblogOfPostId,
      cols.created_at_ms,
      collector,
    )
  }

  syncPostRelatedData(
    db,
    postId,
    status,
    serverId,
    localAccountId,
    accountDomain,
    collector,
  )

  return postId
}

// ================================================================
// 公開ハンドラ
// ================================================================

export function handleUpsertStatus(
  db: DbExec,
  statusJson: string,
  backendUrl: string,
  timelineType: string,
  tag?: string,
): HandlerResult {
  const status = JSON.parse(statusJson) as Entity.Status
  const now = Date.now()
  const collector: WrittenTableCollector = new Set()

  db.exec('BEGIN;')
  try {
    const host = new URL(backendUrl).host
    const serverId = ensureServer(db, host, collector)
    const localAccountId = resolveLocalAccountId(db, backendUrl)
    const timelineKey = buildTimelineKey(timelineType, { tag })

    const postId = upsertSingleStatus(
      db,
      status,
      serverId,
      localAccountId,
      now,
      timelineKey,
      undefined,
      collector,
    )

    // tag timeline から来た場合、ハッシュタグを確保する
    if (tag) {
      ensureTagForPost(db, postId, tag, collector)
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: [...collector] }
}

export function handleBulkUpsertStatuses(
  db: DbExec,
  statusesJson: string[],
  backendUrl: string,
  timelineType: string,
  tag?: string,
  skipProfileUpdate?: boolean,
): HandlerResult {
  if (statusesJson.length === 0) return { changedTables: [] }

  const now = Date.now()
  const uriCache = new Map<string, number>()
  const collector: WrittenTableCollector = new Set()

  db.exec('BEGIN;')
  try {
    const host = new URL(backendUrl).host
    const serverId = ensureServer(db, host, collector)
    const localAccountId = resolveLocalAccountId(db, backendUrl)
    const timelineKey = buildTimelineKey(timelineType, { tag })

    for (const sJson of statusesJson) {
      // SAVEPOINT で個別ステータスの失敗を隔離し、バッチ全体の ROLLBACK を防ぐ
      db.exec('SAVEPOINT sp_status;')
      try {
        const status = JSON.parse(sJson) as Entity.Status

        const postId = upsertSingleStatus(
          db,
          status,
          serverId,
          localAccountId,
          now,
          timelineKey,
          uriCache,
          collector,
          skipProfileUpdate,
        )

        // tag timeline から来た場合、ハッシュタグを確保する
        if (tag) {
          ensureTagForPost(db, postId, tag, collector)
        }

        db.exec('RELEASE sp_status;')
      } catch (e) {
        db.exec('ROLLBACK TO sp_status;')
        db.exec('RELEASE sp_status;')
        console.error('Failed to upsert single status, skipping:', e)
      }
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: [...collector] }
}

// ================================================================
// 内部ヘルパー: ハッシュタグ
// ================================================================

/**
 * tag timeline 経由の投稿に対して、指定タグを post_hashtags に確保する。
 */
function ensureTagForPost(
  db: DbExec,
  postId: number,
  tag: string,
  collector?: WrittenTableCollector,
): void {
  const normalizedTag = tag.toLowerCase()
  db.exec(`INSERT OR IGNORE INTO hashtags (name) VALUES (?);`, {
    bind: [normalizedTag],
  })
  collector?.add('hashtags')
  const tagRows = db.exec('SELECT id FROM hashtags WHERE name = ?;', {
    bind: [normalizedTag],
    returnValue: 'resultRows',
  }) as number[][]
  if (tagRows.length > 0) {
    db.exec(
      'INSERT OR IGNORE INTO post_hashtags (post_id, hashtag_id) VALUES (?, ?);',
      { bind: [postId, tagRows[0][0]] },
    )
    collector?.add('post_hashtags')
  }
}
