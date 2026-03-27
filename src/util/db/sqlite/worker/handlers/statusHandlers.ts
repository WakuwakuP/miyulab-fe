/**
 * Status 関連のハンドラ群
 *
 * workerStatusStore.ts から分割。ロジック変更なし。
 */

import type { Entity } from 'megalodon'
import {
  ensureProfile,
  ensureProfileAlias,
  ensureServer,
  ensureTimeline,
  extractStatusColumns,
  resolveEmojisFromDb,
  resolveLocalAccountId,
  resolvePostItemKindId,
  syncPollData,
  syncPostCustomEmojis,
  syncPostHashtags,
  syncPostLinkCard,
  syncProfileCustomEmojis,
  toggleEngagement,
} from '../../shared'
import {
  ensureReblogOriginalPost,
  resolveDelayedReplyReferences,
  resolveDelayedRepostReferences,
  syncPostMedia,
  syncPostStats,
  upsertMentionsInternal,
} from './postSync'
import {
  cachedPostItemKindId,
  deriveAccountDomain,
  getLastInsertRowId,
  resolvePostIdInternal,
  resolveReplyToPostId,
  resolveRepostOfPostId,
  resolveVisibilityId,
  setCachedPostItemKindId,
} from './statusHelpers'
import type { DbExec, HandlerResult } from './types'

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
  const normalizedUri = status.uri?.trim() || ''
  const now = Date.now()
  const created_at_ms = new Date(status.created_at).getTime()
  const cols = extractStatusColumns(status)

  db.exec('BEGIN;')
  try {
    const serverId = ensureServer(db, backendUrl)
    const visibilityId = resolveVisibilityId(db, cols.visibility)
    const profileId = ensureProfile(db, status.account)
    ensureProfileAlias(db, profileId, serverId, status.account.id)
    const acctEmojis =
      status.account.emojis.length > 0
        ? status.account.emojis
        : resolveEmojisFromDb(
            db,
            serverId,
            status.account.display_name,
            backendUrl,
          )
    if (acctEmojis.length > 0) {
      syncProfileCustomEmojis(db, profileId, serverId, acctEmojis)
    }

    let postId: number | undefined
    let existingIsOriginal = false

    // URI で既存投稿を検索
    if (normalizedUri) {
      const existingRows = db.exec(
        'SELECT post_id, is_reblog FROM posts WHERE object_uri = ?;',
        { bind: [normalizedUri], returnValue: 'resultRows' },
      ) as number[][]
      if (existingRows.length > 0) {
        if (cols.is_reblog === 1 && existingRows[0][1] === 0) {
          existingIsOriginal = true
        } else {
          postId = existingRows[0][0]
        }
      }
    }

    // URI で見つからない場合、posts_backends で検索
    if (postId === undefined && !existingIsOriginal) {
      postId = resolvePostIdInternal(db, backendUrl, status.id) ?? undefined
    }

    // Pleroma/Misskey: リブログの URI が元投稿と同一の場合、
    // リブログ行に元投稿の URI を割り当てない（元投稿側が URI を保持する）
    if (
      postId === undefined &&
      !existingIsOriginal &&
      cols.is_reblog === 1 &&
      normalizedUri !== '' &&
      normalizedUri === cols.reblog_of_uri
    ) {
      existingIsOriginal = true
    }

    // クロスサーバーリブログの重複検出:
    // 異なるバックエンドから同一リブログが届いた場合（例: Pleroma では URI が
    // 元投稿と同一になり空で保存される一方、Misskey では Announce URI が付与される）、
    // 同一の元投稿URI＋同一投稿者の既存リブログを検索してマージする。
    // author_profile_id はバックエンドごとに URL 形式が異なるため一致しない
    // ことがある（例: Pleroma /users/X vs Misskey /@X）ため、
    // username + domain で照合する。
    let foundViaReblogDedup = false
    if (postId === undefined && cols.is_reblog === 1 && cols.reblog_of_uri) {
      const rebloggerDomain = deriveAccountDomain(status.account)
      if (rebloggerDomain) {
        const existingReblog = db.exec(
          `SELECT p.post_id FROM posts p
           JOIN profiles pr ON pr.profile_id = p.author_profile_id
           WHERE p.is_reblog = 1 AND p.reblog_of_uri = ?
             AND pr.username = ?
             AND (pr.domain = ? OR pr.actor_uri LIKE ?)
           LIMIT 1;`,
          {
            bind: [
              cols.reblog_of_uri,
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

    const replyToPostId = resolveReplyToPostId(
      db,
      cols.in_reply_to_id,
      serverId,
    )
    const repostOfPostId =
      cols.is_reblog === 1
        ? resolveRepostOfPostId(db, cols.reblog_of_uri)
        : null

    if (postId !== undefined) {
      // author_profile_id は更新しない:
      // ActivityPub では投稿の著者は不変であり、同一バックエンドからの
      // 再取得では同じ profile_id が返るため no-op。
      // 異なるバックエンドからの到着時は actor_uri の URL 形式差異
      // (例: /users/X vs /@X) により別プロファイルが生成されるため、
      // 上書きすると spb が選択するバックエンドの profile_aliases が
      // 存在しなくなる。INSERT 時にのみ設定する。
      db.exec(
        `UPDATE posts SET
          stored_at          = ?,
          visibility_id      = ?,
          language           = ?,
          content_html       = ?,
          spoiler_text       = ?,
          canonical_url      = ?,
          has_media          = ?,
          media_count        = ?,
          is_reblog          = ?,
          reblog_of_uri      = ?,
          is_sensitive       = ?,
          has_spoiler        = ?,
          in_reply_to_id     = ?,
          edited_at          = ?,
          reply_to_post_id   = ?,
          repost_of_post_id  = ?
        WHERE post_id = ?;`,
        {
          bind: [
            now,
            visibilityId,
            cols.language,
            cols.content_html,
            cols.spoiler_text,
            cols.canonical_url,
            cols.has_media,
            cols.media_count,
            cols.is_reblog,
            cols.reblog_of_uri,
            cols.is_sensitive,
            cols.has_spoiler,
            cols.in_reply_to_id,
            cols.edited_at,
            replyToPostId,
            repostOfPostId,
            postId,
          ],
        },
      )
    } else {
      const insertUri = existingIsOriginal ? '' : cols.uri
      db.exec(
        `INSERT INTO posts (
          object_uri, origin_server_id, created_at_ms, stored_at,
          author_profile_id, visibility_id, language,
          content_html, spoiler_text, canonical_url,
          has_media, media_count, is_reblog, reblog_of_uri,
          is_sensitive, has_spoiler, in_reply_to_id,
          is_local_only, edited_at,
          reply_to_post_id, repost_of_post_id
        ) VALUES (?,?,?,?, ?,?,?, ?,?,?, ?,?,?,?, ?,?,?, ?,?, ?,?);`,
        {
          bind: [
            insertUri,
            serverId,
            created_at_ms,
            now,
            profileId,
            visibilityId,
            cols.language,
            cols.content_html,
            cols.spoiler_text,
            cols.canonical_url,
            cols.has_media,
            cols.media_count,
            cols.is_reblog,
            cols.reblog_of_uri,
            cols.is_sensitive,
            cols.has_spoiler,
            cols.in_reply_to_id,
            0,
            cols.edited_at,
            replyToPostId,
            repostOfPostId,
          ],
        },
      )
      postId = getLastInsertRowId(db)
    }

    // リブログマージ時: 既存行の object_uri が空で、新しい URI が
    // 有効な Announce URI の場合は補完する
    if (
      foundViaReblogDedup &&
      normalizedUri &&
      normalizedUri !== cols.reblog_of_uri
    ) {
      db.exec(
        `UPDATE posts SET object_uri = ? WHERE post_id = ? AND object_uri = '';`,
        { bind: [normalizedUri, postId] },
      )
    }

    db.exec(
      `INSERT OR IGNORE INTO posts_backends (server_id, local_id, post_id, backendUrl)
       VALUES (?, ?, ?, ?);`,
      { bind: [serverId, status.id, postId, backendUrl] },
    )

    // Delayed resolution: update other posts that reference this post
    resolveDelayedReplyReferences(db, postId, status.id, serverId)
    if (normalizedUri) {
      resolveDelayedRepostReferences(db, postId, normalizedUri)
    }

    // timeline_items に登録（timelines が未作成なら自動作成）
    const localAccountId = resolveLocalAccountId(db, backendUrl)
    const isAccountSpecificTimeline =
      timelineType === 'home' || timelineType === 'notification'
    const timelineId = ensureTimeline(
      db,
      serverId,
      timelineType,
      tag,
      isAccountSpecificTimeline ? localAccountId : null,
    )
    if (cachedPostItemKindId === null) {
      setCachedPostItemKindId(resolvePostItemKindId(db))
    }
    const postItemKindId = cachedPostItemKindId
    db.exec(
      `INSERT OR IGNORE INTO timeline_items (timeline_id, timeline_item_kind_id, post_id, sort_key, inserted_at)
       VALUES (?, ?, ?, ?, ?);`,
      { bind: [timelineId, postItemKindId, postId, created_at_ms, now] },
    )

    upsertMentionsInternal(db, postId, status.mentions, serverId)
    syncPostMedia(db, postId, status.media_attachments, status.sensitive)
    syncPostStats(db, postId, status)

    // エンゲージメント同期（サーバーから返されたフラグをDBに反映）
    // === true で設定、=== false で解除、null/undefined はスキップ（データなし）
    if (localAccountId !== null) {
      if (status.favourited === true) {
        toggleEngagement(db, localAccountId, postId, 'favourite', true)
      } else if (status.favourited === false) {
        toggleEngagement(db, localAccountId, postId, 'favourite', false)
      }
      if (status.reblogged === true) {
        toggleEngagement(db, localAccountId, postId, 'reblog', true)
      } else if (status.reblogged === false) {
        toggleEngagement(db, localAccountId, postId, 'reblog', false)
      }
      if (status.bookmarked === true) {
        toggleEngagement(db, localAccountId, postId, 'bookmark', true)
      } else if (status.bookmarked === false) {
        toggleEngagement(db, localAccountId, postId, 'bookmark', false)
      }
    }

    const statusEmojisResolved =
      status.emojis?.length > 0
        ? status.emojis
        : resolveEmojisFromDb(
            db,
            serverId,
            status.plain_content ?? null,
            backendUrl,
          )
    const accountEmojisResolved =
      status.account?.emojis?.length > 0
        ? status.account.emojis
        : resolveEmojisFromDb(
            db,
            serverId,
            status.account?.display_name ?? null,
            backendUrl,
          )
    syncPostCustomEmojis(
      db,
      postId,
      serverId,
      statusEmojisResolved,
      accountEmojisResolved,
    )
    syncPostHashtags(db, postId, status.tags)

    // If a specific tag was provided (e.g. from tag timeline), ensure it's in post_hashtags too
    if (tag) {
      const normalizedTag = tag.toLowerCase()
      db.exec(
        `INSERT OR IGNORE INTO hashtags (normalized_name, display_name) VALUES (?, ?);`,
        { bind: [normalizedTag, tag] },
      )
      const tagRows = db.exec(
        'SELECT hashtag_id FROM hashtags WHERE normalized_name = ?;',
        { bind: [normalizedTag], returnValue: 'resultRows' },
      ) as number[][]
      if (tagRows.length > 0) {
        db.exec(
          'INSERT OR IGNORE INTO post_hashtags (post_id, hashtag_id) VALUES (?, ?);',
          { bind: [postId, tagRows[0][0]] },
        )
      }
    }
    syncPollData(db, postId, status.poll)
    syncPostLinkCard(db, postId, status.card)

    if (cols.is_reblog === 1 && cols.reblog_of_uri) {
      db.exec(
        `INSERT OR REPLACE INTO posts_reblogs (post_id, original_uri, reblogger_acct, reblogged_at_ms)
         VALUES (?, ?, ?, ?);`,
        {
          bind: [
            postId,
            cols.reblog_of_uri,
            status.account.acct,
            created_at_ms,
          ],
        },
      )

      // リブログ元投稿も保存（reblog フィールド復元用）
      if (status.reblog) {
        ensureReblogOriginalPost(
          db,
          status.reblog,
          backendUrl,
          serverId,
          now,
          localAccountId,
        )
      }
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
    const serverId = ensureServer(db, backendUrl)
    const localAccountId = resolveLocalAccountId(db, backendUrl)
    const isAccountSpecificTimeline =
      timelineType === 'home' || timelineType === 'notification'
    const timelineId = ensureTimeline(
      db,
      serverId,
      timelineType,
      tag,
      isAccountSpecificTimeline ? localAccountId : null,
    )
    if (cachedPostItemKindId === null) {
      setCachedPostItemKindId(resolvePostItemKindId(db))
    }
    const postItemKindId = cachedPostItemKindId

    for (const sJson of statusesJson) {
      const status = JSON.parse(sJson) as Entity.Status
      const normalizedUri = status.uri?.trim() || ''
      const created_at_ms = new Date(status.created_at).getTime()
      const cols = extractStatusColumns(status)
      const visibilityId = resolveVisibilityId(db, cols.visibility)
      const profileId = ensureProfile(db, status.account)
      ensureProfileAlias(db, profileId, serverId, status.account.id)
      const bulkAcctEmojis =
        status.account.emojis.length > 0
          ? status.account.emojis
          : resolveEmojisFromDb(
              db,
              serverId,
              status.account.display_name,
              backendUrl,
            )
      if (bulkAcctEmojis.length > 0) {
        syncProfileCustomEmojis(db, profileId, serverId, bulkAcctEmojis)
      }

      let postId: number | undefined = normalizedUri
        ? uriCache.get(normalizedUri)
        : undefined

      // リブログが元投稿を上書きしないようにする
      let existingIsOriginal = false

      if (postId === undefined && normalizedUri) {
        const existingRows = db.exec(
          'SELECT post_id, is_reblog FROM posts WHERE object_uri = ?;',
          { bind: [normalizedUri], returnValue: 'resultRows' },
        ) as number[][]
        if (existingRows.length > 0) {
          if (cols.is_reblog === 1 && existingRows[0][1] === 0) {
            existingIsOriginal = true
          } else {
            postId = existingRows[0][0]
          }
        }
      }

      // URI で見つからない場合、posts_backends で検索
      if (postId === undefined && !existingIsOriginal) {
        postId = resolvePostIdInternal(db, backendUrl, status.id) ?? undefined
      }

      // Pleroma/Misskey: リブログの URI が元投稿と同一の場合、
      // リブログ行に元投稿の URI を割り当てない
      if (
        postId === undefined &&
        !existingIsOriginal &&
        cols.is_reblog === 1 &&
        normalizedUri !== '' &&
        normalizedUri === cols.reblog_of_uri
      ) {
        existingIsOriginal = true
      }

      // クロスサーバーリブログの重複検出（handleUpsertStatus と同一ロジック）
      let foundViaReblogDedup = false
      if (postId === undefined && cols.is_reblog === 1 && cols.reblog_of_uri) {
        const rebloggerDomain = deriveAccountDomain(status.account)
        if (rebloggerDomain) {
          const existingReblog = db.exec(
            `SELECT p.post_id FROM posts p
             JOIN profiles pr ON pr.profile_id = p.author_profile_id
             WHERE p.is_reblog = 1 AND p.reblog_of_uri = ?
               AND pr.username = ?
               AND (pr.domain = ? OR pr.actor_uri LIKE ?)
             LIMIT 1;`,
            {
              bind: [
                cols.reblog_of_uri,
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

      const replyToPostId = resolveReplyToPostId(
        db,
        cols.in_reply_to_id,
        serverId,
      )
      const repostOfPostId =
        cols.is_reblog === 1
          ? resolveRepostOfPostId(db, cols.reblog_of_uri)
          : null

      if (postId !== undefined) {
        // author_profile_id は更新しない（handleUpsertStatus と同一方針）
        db.exec(
          `UPDATE posts SET
            stored_at          = ?,
            visibility_id      = ?,
            language           = ?,
            content_html       = ?,
            spoiler_text       = ?,
            canonical_url      = ?,
            has_media          = ?,
            media_count        = ?,
            is_reblog          = ?,
            reblog_of_uri      = ?,
            is_sensitive       = ?,
            has_spoiler        = ?,
            in_reply_to_id     = ?,
            edited_at          = ?,
            reply_to_post_id   = ?,
            repost_of_post_id  = ?
          WHERE post_id = ?;`,
          {
            bind: [
              now,
              visibilityId,
              cols.language,
              cols.content_html,
              cols.spoiler_text,
              cols.canonical_url,
              cols.has_media,
              cols.media_count,
              cols.is_reblog,
              cols.reblog_of_uri,
              cols.is_sensitive,
              cols.has_spoiler,
              cols.in_reply_to_id,
              cols.edited_at,
              replyToPostId,
              repostOfPostId,
              postId,
            ],
          },
        )
      } else {
        const insertUri = existingIsOriginal ? '' : cols.uri
        db.exec(
          `INSERT INTO posts (
            object_uri, origin_server_id, created_at_ms, stored_at,
            author_profile_id, visibility_id, language,
            content_html, spoiler_text, canonical_url,
            has_media, media_count, is_reblog, reblog_of_uri,
            is_sensitive, has_spoiler, in_reply_to_id,
            is_local_only, edited_at,
            reply_to_post_id, repost_of_post_id
          ) VALUES (?,?,?,?, ?,?,?, ?,?,?, ?,?,?,?, ?,?,?, ?,?, ?,?);`,
          {
            bind: [
              insertUri,
              serverId,
              created_at_ms,
              now,
              profileId,
              visibilityId,
              cols.language,
              cols.content_html,
              cols.spoiler_text,
              cols.canonical_url,
              cols.has_media,
              cols.media_count,
              cols.is_reblog,
              cols.reblog_of_uri,
              cols.is_sensitive,
              cols.has_spoiler,
              cols.in_reply_to_id,
              0,
              cols.edited_at,
              replyToPostId,
              repostOfPostId,
            ],
          },
        )
        postId = getLastInsertRowId(db)
      }

      // リブログマージ時: 既存行の object_uri が空の場合、実 Announce URI を補完する
      if (
        foundViaReblogDedup &&
        normalizedUri &&
        normalizedUri !== cols.reblog_of_uri
      ) {
        db.exec(
          `UPDATE posts SET object_uri = ? WHERE post_id = ? AND object_uri = '';`,
          { bind: [normalizedUri, postId] },
        )
        uriCache.set(normalizedUri, postId)
      }

      // 同一 URI リブログの場合はキャッシュしない（元投稿が URI を使えるようにする）
      if (
        normalizedUri &&
        !(cols.is_reblog === 1 && normalizedUri === cols.reblog_of_uri)
      ) {
        uriCache.set(normalizedUri, postId)
      }

      db.exec(
        `INSERT OR IGNORE INTO posts_backends (server_id, local_id, post_id, backendUrl)
         VALUES (?, ?, ?, ?);`,
        { bind: [serverId, status.id, postId, backendUrl] },
      )

      // Delayed resolution: update other posts that reference this post
      resolveDelayedReplyReferences(db, postId, status.id, serverId)
      if (normalizedUri) {
        resolveDelayedRepostReferences(db, postId, normalizedUri)
      }

      // timeline_items に登録
      db.exec(
        `INSERT OR IGNORE INTO timeline_items (timeline_id, timeline_item_kind_id, post_id, sort_key, inserted_at)
         VALUES (?, ?, ?, ?, ?);`,
        { bind: [timelineId, postItemKindId, postId, created_at_ms, now] },
      )

      upsertMentionsInternal(db, postId, status.mentions, serverId)
      syncPostMedia(db, postId, status.media_attachments, status.sensitive)
      syncPostStats(db, postId, status)

      // エンゲージメント同期（サーバーから返されたフラグをDBに反映）
      // === true で設定、=== false で解除、null/undefined はスキップ（データなし）
      if (localAccountId !== null) {
        if (status.favourited === true) {
          toggleEngagement(db, localAccountId, postId, 'favourite', true)
        } else if (status.favourited === false) {
          toggleEngagement(db, localAccountId, postId, 'favourite', false)
        }
        if (status.reblogged === true) {
          toggleEngagement(db, localAccountId, postId, 'reblog', true)
        } else if (status.reblogged === false) {
          toggleEngagement(db, localAccountId, postId, 'reblog', false)
        }
        if (status.bookmarked === true) {
          toggleEngagement(db, localAccountId, postId, 'bookmark', true)
        } else if (status.bookmarked === false) {
          toggleEngagement(db, localAccountId, postId, 'bookmark', false)
        }
      }

      const bulkStatusEmojis =
        status.emojis?.length > 0
          ? status.emojis
          : resolveEmojisFromDb(
              db,
              serverId,
              status.plain_content ?? null,
              backendUrl,
            )
      const bulkAccountEmojis =
        status.account?.emojis?.length > 0
          ? status.account.emojis
          : resolveEmojisFromDb(
              db,
              serverId,
              status.account?.display_name ?? null,
              backendUrl,
            )
      syncPostCustomEmojis(
        db,
        postId,
        serverId,
        bulkStatusEmojis,
        bulkAccountEmojis,
      )
      syncPostHashtags(db, postId, status.tags)

      // If a specific tag was provided (e.g. from tag timeline), ensure it's in post_hashtags too
      if (tag) {
        const normalizedTag = tag.toLowerCase()
        db.exec(
          `INSERT OR IGNORE INTO hashtags (normalized_name, display_name) VALUES (?, ?);`,
          { bind: [normalizedTag, tag] },
        )
        const tagRows = db.exec(
          'SELECT hashtag_id FROM hashtags WHERE normalized_name = ?;',
          { bind: [normalizedTag], returnValue: 'resultRows' },
        ) as number[][]
        if (tagRows.length > 0) {
          db.exec(
            'INSERT OR IGNORE INTO post_hashtags (post_id, hashtag_id) VALUES (?, ?);',
            { bind: [postId, tagRows[0][0]] },
          )
        }
      }
      syncPollData(db, postId, status.poll)
      syncPostLinkCard(db, postId, status.card)

      // リブログ関係を posts_reblogs に記録（元投稿の URI が存在する場合のみ）
      if (cols.is_reblog === 1 && cols.reblog_of_uri) {
        db.exec(
          `INSERT OR REPLACE INTO posts_reblogs (post_id, original_uri, reblogger_acct, reblogged_at_ms)
           VALUES (?, ?, ?, ?);`,
          {
            bind: [
              postId,
              cols.reblog_of_uri,
              status.account.acct,
              created_at_ms,
            ],
          },
        )

        // リブログ元投稿も保存（reblog フィールド復元用）
        if (status.reblog) {
          ensureReblogOriginalPost(
            db,
            status.reblog,
            backendUrl,
            serverId,
            now,
            localAccountId,
          )
        }
      }
    }
    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables: ['posts'] }
}
