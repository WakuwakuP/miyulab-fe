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
import type { DbExec, HandlerResult } from './types'

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
): void {
  if (status.favourited === true) {
    updateInteraction(db, postId, localAccountId, 'favourite', true)
  } else if (status.favourited === false) {
    updateInteraction(db, postId, localAccountId, 'favourite', false)
  }
  if (status.reblogged === true) {
    updateInteraction(db, postId, localAccountId, 'reblog', true)
  } else if (status.reblogged === false) {
    updateInteraction(db, postId, localAccountId, 'reblog', false)
  }
  if (status.bookmarked === true) {
    updateInteraction(db, postId, localAccountId, 'bookmark', true)
  } else if (status.bookmarked === false) {
    updateInteraction(db, postId, localAccountId, 'bookmark', false)
  }
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
): number {
  const normalizedUri = status.uri?.trim() || ''
  const cols = extractPostColumns(status)
  const visibilityId = resolveVisibilityId(db, cols.visibility_id.toString())
  const profileId = ensureProfile(db, status.account, serverId)

  const accountDomain = deriveAccountDomain(status.account)
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
    syncProfileCustomEmojis(db, profileId, serverId, acctEmojis)
  }

  const isReblog = status.reblog != null ? 1 : 0
  const reblogOfUri = status.reblog?.uri ?? null

  // リブログ元投稿を先に保存（reblog_of_post_id 解決のため）
  if (isReblog === 1 && status.reblog) {
    ensureReblogOriginalPost(
      db,
      status.reblog,
      '',
      serverId,
      now,
      localAccountId,
    )
  }

  // ================================================================
  // 既存投稿の検索
  // ================================================================

  let postId: number | undefined = normalizedUri
    ? uriCache?.get(normalizedUri)
    : undefined
  let existingIsOriginal = false

  // URI で既存投稿を検索（リブログ行は対象外 — 同一 URI のリブログを上書きしない）
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

  // URI で見つからない場合、post_backend_ids で検索
  if (postId === undefined && !existingIsOriginal && localAccountId !== null) {
    postId = resolvePostIdInternal(db, localAccountId, status.id) ?? undefined
  }

  // Pleroma/Misskey: リブログの URI が元投稿と同一の場合、
  // リブログ行に元投稿の URI を割り当てない（元投稿側が URI を保持する）
  if (
    postId === undefined &&
    !existingIsOriginal &&
    isReblog === 1 &&
    normalizedUri !== '' &&
    normalizedUri === reblogOfUri
  ) {
    existingIsOriginal = true
  }

  // クロスサーバーリブログの重複検出:
  // 異なるバックエンドから同一リブログが届いた場合、
  // 同一の元投稿URI＋同一投稿者の既存リブログを検索してマージする。
  let foundViaReblogDedup = false
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

  // ================================================================
  // reblog_of_post_id の解決
  // ================================================================
  const reblogOfPostId =
    isReblog === 1 ? resolveRepostOfPostId(db, reblogOfUri) : null

  // ================================================================
  // INSERT or UPDATE
  // ================================================================

  if (postId !== undefined) {
    // author_profile_id は更新しない:
    // ActivityPub では投稿の著者は不変。異なるバックエンドからの到着時は
    // actor_uri の URL 形式差異により別プロファイルが生成されるため、
    // 上書きすると不整合が起きる。INSERT 時にのみ設定する。
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
          null, // quote_of_post_id: 将来拡張用
          postId,
        ],
      },
    )
  } else {
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
          null, // quote_of_post_id
        ],
      },
    )
    postId = getLastInsertRowId(db)
  }

  // リブログマージ時: 既存行の object_uri が空で、新しい URI が
  // 有効な Announce URI の場合は補完する
  if (foundViaReblogDedup && normalizedUri && normalizedUri !== reblogOfUri) {
    db.exec(
      `UPDATE posts SET object_uri = ? WHERE id = ? AND object_uri = '';`,
      { bind: [normalizedUri, postId] },
    )
    uriCache?.set(normalizedUri, postId)
  }

  // 同一 URI リブログの場合はキャッシュしない（元投稿が URI を使えるようにする）
  if (
    uriCache &&
    normalizedUri &&
    !(isReblog === 1 && normalizedUri === reblogOfUri)
  ) {
    uriCache.set(normalizedUri, postId)
  }

  // ================================================================
  // post_backend_ids に登録
  // ================================================================
  if (localAccountId !== null) {
    db.exec(
      `INSERT OR IGNORE INTO post_backend_ids (post_id, local_account_id, local_id, server_id)
       VALUES (?, ?, ?, ?);`,
      { bind: [postId, localAccountId, status.id, serverId] },
    )
  }

  // ================================================================
  // timeline_entries に登録
  // ================================================================
  if (localAccountId !== null) {
    const displayPostId = isReblog === 1 ? reblogOfPostId : null
    db.exec(
      `INSERT OR IGNORE INTO timeline_entries (local_account_id, timeline_key, post_id, display_post_id, created_at_ms)
       VALUES (?, ?, ?, ?, ?);`,
      {
        bind: [
          localAccountId,
          timelineKey,
          postId,
          displayPostId,
          cols.created_at_ms,
        ],
      },
    )
  }

  // ================================================================
  // 関連データの同期
  // ================================================================
  upsertMentionsInternal(db, postId, status.mentions)
  syncPostMedia(db, postId, status.media_attachments)
  syncPostStats(db, postId, status)

  // エンゲージメント同期
  if (localAccountId !== null) {
    syncInteractions(db, postId, localAccountId, status)
  }

  // カスタム絵文字
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
  syncPostCustomEmojis(db, postId, serverId, [
    ...statusEmojisResolved,
    ...accountEmojisResolved,
  ])
  syncPostHashtags(db, postId, status.tags)
  syncPollData(db, postId, status.poll)
  syncLinkCard(db, postId, status.card)

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

  db.exec('BEGIN;')
  try {
    const host = new URL(backendUrl).host
    const serverId = ensureServer(db, host)
    const localAccountId = resolveLocalAccountId(db, backendUrl)
    const timelineKey = buildTimelineKey(timelineType, { tag })

    const postId = upsertSingleStatus(
      db,
      status,
      serverId,
      localAccountId,
      now,
      timelineKey,
    )

    // tag timeline から来た場合、ハッシュタグを確保する
    if (tag) {
      ensureTagForPost(db, postId, tag)
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['posts'] }
}

export function handleBulkUpsertStatuses(
  db: DbExec,
  statusesJson: string[],
  backendUrl: string,
  timelineType: string,
  tag?: string,
): HandlerResult {
  if (statusesJson.length === 0) return { changedTables: [] }

  const now = Date.now()
  const uriCache = new Map<string, number>()

  db.exec('BEGIN;')
  try {
    const host = new URL(backendUrl).host
    const serverId = ensureServer(db, host)
    const localAccountId = resolveLocalAccountId(db, backendUrl)
    const timelineKey = buildTimelineKey(timelineType, { tag })

    for (const sJson of statusesJson) {
      const status = JSON.parse(sJson) as Entity.Status

      const postId = upsertSingleStatus(
        db,
        status,
        serverId,
        localAccountId,
        now,
        timelineKey,
        uriCache,
      )

      // tag timeline から来た場合、ハッシュタグを確保する
      if (tag) {
        ensureTagForPost(db, postId, tag)
      }
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['posts'] }
}

// ================================================================
// 内部ヘルパー: ハッシュタグ
// ================================================================

/**
 * tag timeline 経由の投稿に対して、指定タグを post_hashtags に確保する。
 */
function ensureTagForPost(db: DbExec, postId: number, tag: string): void {
  const normalizedTag = tag.toLowerCase()
  db.exec(`INSERT OR IGNORE INTO hashtags (name) VALUES (?);`, {
    bind: [normalizedTag],
  })
  const tagRows = db.exec('SELECT id FROM hashtags WHERE name = ?;', {
    bind: [normalizedTag],
    returnValue: 'resultRows',
  }) as number[][]
  if (tagRows.length > 0) {
    db.exec(
      'INSERT OR IGNORE INTO post_hashtags (post_id, hashtag_id) VALUES (?, ?);',
      { bind: [postId, tagRows[0][0]] },
    )
  }
}
