/**
 * Worker 側: クリーンアップ処理
 *
 * 1 呼び出し = 1 バッチ設計。呼び出し側は `hasMore === false` になるまで繰り返す。
 *
 * 優先順: (a) timeline_entries 超過分 → (b) notifications 超過分 → (c) posts 超過分 / 孤立 posts。
 * `batchLimit` (default 2,000) を超えないように 1 回の呼び出しで削除する。
 * これにより単一トランザクションが肥大化してタイムアウトする問題を回避する。
 *
 * posts cleanup の方針:
 *   - posts 総件数が `maxPosts` を超えたら、孤立 (= timeline_entries / notifications /
 *     他 posts の reblog_of_post_id / quote_of_post_id から参照されていない) かつ古い post を
 *     `created_at_ms ASC` で削除する。
 *   - reblog/quote の親 post は子 post から参照されているため即座には消えないが、
 *     先に子 (reblog post) が孤立として消えれば、次のバッチで親も孤立化して消える。
 *     `enforceMaxLength` 側のループで連鎖的に解消される。
 *   - timeline_entries / notifications で削除が発生したときも、新たに孤立化した posts を
 *     同じバッチで掃除する (旧 Phase 2 の役割と統合)。
 */

import type { TableName } from '../protocol'

type DbExec = {
  exec: (
    sql: string,
    opts?: {
      bind?: (string | number | null)[]
      returnValue?: 'resultRows'
    },
  ) => unknown
}

/**
 * 1 バッチあたりの削除上限（default）
 *
 * OPFS 上の SQLite では 1 件あたりの DELETE コスト (WAL 書き込み + fsync) が
 * 無視できないため、90s の Worker タイムアウト内に確実に完了するサイズに抑える。
 * 旧値 10,000 ではタイムアウトするケースがあったため 2,000 に引き下げた。
 */
const DEFAULT_BATCH_LIMIT = 2_000

export type EnforceMaxLengthOptions = {
  /** 'periodic' (default) または 'emergency' */
  mode?: 'periodic' | 'emergency'
  /** emergency モードで各グループに残す割合 (0 < x <= 1)。default 0.5 */
  targetRatio?: number
  /** 1 バッチあたりの削除上限。default 2,000 */
  batchLimit?: number
}

export type EnforceMaxLengthHandlerResult = {
  changedTables: TableName[]
  hasMore: boolean
  deletedCounts: {
    timeline_entries: number
    notifications: number
    posts: number
  }
}

function readChanges(db: DbExec): number {
  const rows = db.exec('SELECT changes();', {
    returnValue: 'resultRows',
  }) as number[][]
  if (rows.length > 0 && rows[0] !== undefined) {
    return rows[0][0] ?? 0
  }
  return 0
}

/**
 * (local_account_id, timeline_key) グループで超過 1 件以上あるか確認しつつ 1 バッチ削除する。
 * 戻り値は { deleted, issuedDelete, remainingBudget, hasRemainingExcess }。
 */
function processTimelineBatch(
  db: DbExec,
  maxTimeline: number,
  mode: 'periodic' | 'emergency',
  targetRatio: number,
  budget: number,
): {
  deleted: number
  issuedDelete: boolean
  remainingBudget: number
  hasRemainingExcess: boolean
} {
  // emergency モードでは maxTimeline の制限を外して全グループを対象とする
  // (ターゲットは cnt * targetRatio で決まる)。HAVING の閾値は 0 にする。
  const havingThreshold = mode === 'emergency' ? 0 : maxTimeline

  // 超過のあるグループを列挙
  const groups = db.exec(
    'SELECT local_account_id, timeline_key, COUNT(*) as cnt FROM timeline_entries GROUP BY local_account_id, timeline_key HAVING cnt > ?;',
    { bind: [havingThreshold], returnValue: 'resultRows' },
  ) as (number | string)[][]

  let deleted = 0
  let issuedDelete = false
  let remaining = budget
  let hasRemainingExcess = false

  for (const [laId, tlKey, cntRaw] of groups) {
    const cnt = cntRaw as number
    // emergency モード: cnt * targetRatio を残す → 超過 = cnt - floor(cnt * targetRatio)
    // periodic モード: maxTimeline を残す → 超過 = cnt - maxTimeline
    const target =
      mode === 'emergency' ? Math.floor(cnt * targetRatio) : maxTimeline
    const excess = cnt - target
    if (excess <= 0) continue

    if (remaining <= 0) {
      hasRemainingExcess = true
      break
    }

    const limit = Math.min(excess, remaining)
    db.exec(
      `DELETE FROM timeline_entries WHERE id IN (
        SELECT id FROM timeline_entries
        WHERE local_account_id = ? AND timeline_key = ?
        ORDER BY created_at_ms ASC
        LIMIT ?
      );`,
      { bind: [laId, tlKey, limit] },
    )
    issuedDelete = true
    const changed = readChanges(db)
    deleted += changed
    remaining -= limit
    if (excess > limit) {
      hasRemainingExcess = true
    }
  }

  return {
    deleted,
    hasRemainingExcess,
    issuedDelete,
    remainingBudget: remaining,
  }
}

function processNotificationsBatch(
  db: DbExec,
  maxNotifications: number,
  mode: 'periodic' | 'emergency',
  targetRatio: number,
  budget: number,
): {
  deleted: number
  issuedDelete: boolean
  remainingBudget: number
  hasRemainingExcess: boolean
} {
  const havingThreshold = mode === 'emergency' ? 0 : maxNotifications

  const groups = db.exec(
    'SELECT local_account_id, COUNT(*) as cnt FROM notifications GROUP BY local_account_id HAVING cnt > ?;',
    { bind: [havingThreshold], returnValue: 'resultRows' },
  ) as number[][]

  let deleted = 0
  let issuedDelete = false
  let remaining = budget
  let hasRemainingExcess = false

  for (const [laId, cnt] of groups) {
    const target =
      mode === 'emergency' ? Math.floor(cnt * targetRatio) : maxNotifications
    const excess = cnt - target
    if (excess <= 0) continue

    if (remaining <= 0) {
      hasRemainingExcess = true
      break
    }

    const limit = Math.min(excess, remaining)
    db.exec(
      `DELETE FROM notifications WHERE id IN (
        SELECT id FROM notifications
        WHERE local_account_id = ?
        ORDER BY created_at_ms ASC
        LIMIT ?
      );`,
      { bind: [laId, limit] },
    )
    issuedDelete = true
    const changed = readChanges(db)
    deleted += changed
    remaining -= limit
    if (excess > limit) {
      hasRemainingExcess = true
    }
  }

  return {
    deleted,
    hasRemainingExcess,
    issuedDelete,
    remainingBudget: remaining,
  }
}

/**
 * posts 総件数の超過分を「孤立かつ古い順」に 1 バッチ削除する。
 *
 * 「孤立」= 以下のいずれからも参照されていない:
 *   - timeline_entries.post_id
 *   - notifications.related_post_id
 *   - 他 posts.reblog_of_post_id
 *   - 他 posts.quote_of_post_id
 *
 * reblog_of_post_id / quote_of_post_id は posts 同士の自己参照 FK で
 * ON DELETE 指定がないため、参照されている行を削除しようとすると
 * SQLITE_CONSTRAINT_FOREIGNKEY が発生する。先に子 (reblog post 側) が
 * 孤立化して削除されれば、次バッチで親も孤立化して削除可能になる。
 *
 * @param maxPosts 残したい posts 総件数の上限
 * @param mode 'periodic' なら maxPosts まで、'emergency' なら cnt * targetRatio まで
 * @param targetRatio emergency モードで残す割合
 * @param budget 1 バッチで削除可能な上限
 * @param forceCleanup true ならば総件数が上限以下でも 1 バッチだけ孤立 posts を削除する
 *   (timeline_entries / notifications で削除が発生した直後の追従用)
 */
function processPostsBatch(
  db: DbExec,
  maxPosts: number,
  mode: 'periodic' | 'emergency',
  targetRatio: number,
  budget: number,
  forceCleanup: boolean,
): {
  deleted: number
  issuedDelete: boolean
  hasRemainingExcess: boolean
} {
  if (budget <= 0) {
    return {
      deleted: 0,
      hasRemainingExcess: false,
      issuedDelete: false,
    }
  }

  // 現在の総件数を取得
  const cntRows = db.exec('SELECT COUNT(*) FROM posts;', {
    returnValue: 'resultRows',
  }) as number[][]
  const cnt = cntRows[0]?.[0] ?? 0

  // emergency モード: cnt * targetRatio を残す
  // periodic モード: maxPosts を残す
  const target = mode === 'emergency' ? Math.floor(cnt * targetRatio) : maxPosts
  const excess = cnt - target

  // 上限以内かつ forceCleanup でなければ何もしない
  if (excess <= 0 && !forceCleanup) {
    return {
      deleted: 0,
      hasRemainingExcess: false,
      issuedDelete: false,
    }
  }

  // 削除する件数の上限。
  //   - 上限超過分があるならその分まで (budget で頭打ち)
  //   - forceCleanup のみ (excess <= 0) のときは追従掃除として budget ぶんまで許容
  const desiredLimit = excess > 0 ? Math.min(excess, budget) : budget
  if (desiredLimit <= 0) {
    return {
      deleted: 0,
      hasRemainingExcess: false,
      issuedDelete: false,
    }
  }

  // 「孤立」かつ「古い順」で削除。
  //
  // SQL 構造:
  //   - te   (timeline_entries.post_id)       → idx_timeline_entries_post (v2.0.6 で追加)
  //   - n    (notifications.related_post_id)  → idx_notifications_post
  //   - rb   (posts.reblog_of_post_id)        → idx_posts_reblog_of
  //   - qt   (posts.quote_of_post_id)         → idx_posts_quote_of
  //
  // いずれのインデックスも partial index / 単列インデックスが存在するため
  // posts 全件スキャンは発生しない。
  db.exec(
    `DELETE FROM posts WHERE id IN (
      SELECT p.id FROM posts p
      LEFT JOIN timeline_entries te ON te.post_id = p.id
      LEFT JOIN notifications n ON n.related_post_id = p.id
      LEFT JOIN posts rb ON rb.reblog_of_post_id = p.id
      LEFT JOIN posts qt ON qt.quote_of_post_id = p.id
      WHERE te.post_id IS NULL
        AND n.related_post_id IS NULL
        AND rb.id IS NULL
        AND qt.id IS NULL
      ORDER BY p.created_at_ms ASC
      LIMIT ?
    );`,
    { bind: [desiredLimit] },
  )
  const deleted = readChanges(db)

  // hasRemainingExcess は「上限超過がまだ残っているか」のシグナル。
  //   - excess > deleted: まだ超過分が残っている → 次バッチで継続
  //   - deleted === 0: このバッチで何も削れなかった (= 全 posts が参照されている)。
  //     次バッチでも同じ結果になる可能性が高いので false を返してループを抜ける。
  //     timeline/notif 側で参照が外れれば次回 enforceMaxLength で再チャレンジ。
  const hasRemainingExcess = deleted > 0 && excess > deleted

  return {
    deleted,
    hasRemainingExcess,
    issuedDelete: deleted > 0,
  }
}

/**
 * MAX_LENGTH を超えるデータを 1 バッチ削除する。
 *
 * 優先順: (a) timeline_entries → (b) notifications → (c) posts (上限超過 + 孤立掃除)。
 * `batchLimit` を超える作業が残っている場合 `hasMore: true` を返し、
 * 呼び出し側は `hasMore === false` になるまで繰り返し呼び出す。
 *
 * 後方互換: `options` を省略すると従来の periodic モード相当で動作する。
 */
export function handleEnforceMaxLength(
  db: DbExec,
  maxTimeline = 100000,
  maxNotifications = 100000,
  maxPosts = 100000,
  options: EnforceMaxLengthOptions = {},
): EnforceMaxLengthHandlerResult {
  const mode = options.mode ?? 'periodic'
  const targetRatio = options.targetRatio ?? 0.5
  const batchLimit = options.batchLimit ?? DEFAULT_BATCH_LIMIT

  const changedTables: TableName[] = []
  const deletedCounts = {
    notifications: 0,
    posts: 0,
    timeline_entries: 0,
  }
  let hasMore = false
  let needPostsFollowup = false

  // Phase 1: timeline_entries + notifications を 1 トランザクションで処理
  db.exec('BEGIN;')
  try {
    const tlResult = processTimelineBatch(
      db,
      maxTimeline,
      mode,
      targetRatio,
      batchLimit,
    )
    deletedCounts.timeline_entries = tlResult.deleted
    if (tlResult.issuedDelete) {
      needPostsFollowup = true
      if (!changedTables.includes('timeline_entries')) {
        changedTables.push('timeline_entries')
      }
    }
    if (tlResult.hasRemainingExcess) {
      hasMore = true
    }

    const notifBudget = tlResult.remainingBudget
    if (notifBudget > 0) {
      const notifResult = processNotificationsBatch(
        db,
        maxNotifications,
        mode,
        targetRatio,
        notifBudget,
      )
      deletedCounts.notifications = notifResult.deleted
      if (notifResult.issuedDelete) {
        needPostsFollowup = true
        if (!changedTables.includes('notifications')) {
          changedTables.push('notifications')
        }
      }
      if (notifResult.hasRemainingExcess || notifResult.remainingBudget <= 0) {
        hasMore = true
      }
    } else {
      // 予算枯渇: notifications は次回回し
      hasMore = true
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  // Phase 2: posts 上限超過分 / 孤立 posts を 1 バッチ削除（短いトランザクション）
  //
  // 実行条件:
  //   (a) timeline_entries / notifications で削除があった (needPostsFollowup) — 旧 Phase 2 と同等
  //   (b) posts 総件数が maxPosts を超過している (mode=periodic) または常時超過扱い (mode=emergency)
  //
  // どちらの場合も「孤立 (どこからも参照されていない) かつ古い順」で削除する。
  // 上限チェック自体は processPostsBatch 内で行う。
  //
  // reblog/quote 自己参照 FK のため、参照元がある posts は削除されない。
  // 参照元 (reblog post 子) が先に消えれば次バッチで親も孤立化して削除可能になる。
  db.exec('BEGIN;')
  try {
    const postsResult = processPostsBatch(
      db,
      maxPosts,
      mode,
      targetRatio,
      batchLimit,
      needPostsFollowup,
    )
    deletedCounts.posts = postsResult.deleted

    if (needPostsFollowup || postsResult.issuedDelete) {
      // DELETE を発行した時点で posts テーブル変更として扱う（後方互換）。
      // needPostsFollowup のときは旧実装も常に 'posts' を changedTables に
      // 含めていたため、その挙動を維持する。
      if (!changedTables.includes('posts')) {
        changedTables.push('posts')
      }
    }

    if (postsResult.hasRemainingExcess) {
      hasMore = true
    }
    // バッチ上限いっぱいまで削除した場合、まだ作業が残っている可能性あり
    if (postsResult.deleted >= batchLimit) {
      hasMore = true
    }

    db.exec('COMMIT;')
  } catch (e) {
    db.exec('ROLLBACK;')
    throw e
  }

  return { changedTables, deletedCounts, hasMore }
}
