'use client'

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  NotificationAddAppIndex,
  StatusAddAppIndex,
  TimelineConfigV2,
} from 'types/types'
import {
  type ChangeHint,
  getSqliteDb,
  subscribe,
} from 'util/db/sqlite/connection'
import {
  NOTIFICATION_BASE_JOINS,
  NOTIFICATION_SELECT,
  rowToStoredNotification,
  type SqliteStoredNotification,
} from 'util/db/sqlite/notificationStore'
import {
  assembleStatusFromBatch,
  buildBatchMapsFromResults,
  buildScopedBatchTemplates,
  buildScopedEngagementsSql,
  executeBatchQueries,
  PHASE2_BASE_TEMPLATE,
  type SqliteStoredStatus,
  STATUS_BASE_JOINS,
  STATUS_BASE_SELECT,
} from 'util/db/sqlite/statusStore'
import { TIMELINE_QUERY_LIMIT } from 'util/environment'
import { useQueryDuration } from 'util/hooks/useQueryDuration'
import { AppsContext } from 'util/provider/AppsProvider'
import {
  detectReferencedAliases,
  extractNotificationTypeCodes,
  injectProfileIdHint,
  isMixedQuery,
  isNotificationQuery,
  rewriteLegacyColumnsForPhase1,
  upgradeQueryToV2,
} from 'util/queryBuilder'
import { useConfigRefresh } from 'util/timelineRefresh'

/**
 * backendUrl から appIndex を算出するヘルパー
 */
function resolveAppIndex(
  backendUrl: string,
  apps: { backendUrl: string }[],
): number {
  return apps.findIndex((app) => app.backendUrl === backendUrl)
}

function hasUnquotedQuestionMark(query: string): boolean {
  let inSingleQuote = false

  for (let i = 0; i < query.length; i++) {
    const char = query[i]

    if (char === "'") {
      if (inSingleQuote && query[i + 1] === "'") {
        i++
        continue
      }
      inSingleQuote = !inSingleQuote
      continue
    }

    if (!inSingleQuote && char === '?') {
      return true
    }
  }

  return false
}

// ================================================================
// 互換サブクエリ: 旧カラム名をカスタム WHERE 句で使えるようにする
// ================================================================

// STATUS_COMPAT_FROM は施策 A により廃止。
// 旧カラム名の書き換えは queryBuilder.ts の rewriteLegacyColumnsForPhase1() で処理する。

/** notifications 互換サブクエリ FROM 句（旧カラム名を後方互換で提供、JOIN ベース） */
const NOTIF_COMPAT_FROM = `(
      SELECT n2.*,
        COALESCE(la_nc.backend_url, '') AS backend_url,
        COALESCE(nt_nc.name, '') AS notification_type,
        COALESCE(pr_nc.acct, '') AS account_acct
      FROM notifications n2
      LEFT JOIN local_accounts la_nc ON la_nc.id = n2.local_account_id
      LEFT JOIN notification_types nt_nc ON nt_nc.id = n2.notification_type_id
      LEFT JOIN profiles pr_nc ON pr_nc.id = n2.actor_profile_id
    ) n`

// ================================================================
// 混合クエリ用の空サブクエリ定数
// ================================================================

/**
 * ダミー JOIN 用の空サブクエリ定数
 *
 * 混合クエリで対向テーブルのカラムを NULL として提供するために使用する。
 * 実テーブルへの LEFT JOIN ... ON 0 = 1 はフルスキャンを引き起こすため、
 * 0行のサブクエリで代替することでスキャンを完全に回避する。
 *
 * EMPTY_N は Status Phase1 では不要（n.* を WHERE 句内で直接 NULL に置換）。
 * Notification Phase1 の EMPTY_S/PTT/PBT/PME/PB/PRB は引き続き使用する。
 */

const EMPTY_S = `(SELECT
      NULL AS id, NULL AS object_uri, NULL AS origin_server_id,
      NULL AS author_profile_id, NULL AS created_at_ms,
      NULL AS visibility_id, NULL AS language, NULL AS content_html,
      NULL AS plain_content, NULL AS spoiler_text, NULL AS canonical_url,
      NULL AS is_reblog, NULL AS is_sensitive,
      NULL AS in_reply_to_uri, NULL AS in_reply_to_account_acct,
      NULL AS is_local_only, NULL AS edited_at_ms,
      NULL AS reblog_of_post_id, NULL AS quote_of_post_id, NULL AS quote_state,
      NULL AS application_name, NULL AS last_fetched_at
    LIMIT 0)`

/** ptt 互換サブクエリ: timeline_entries → (post_id, timelineType) */
const PTT_COMPAT = `(SELECT te2.post_id, te2.timeline_key AS timelineType FROM timeline_entries te2 WHERE te2.post_id IS NOT NULL)`

/**
 * posts_reblogs 互換サブクエリ:
 * posts.reblog_of_post_id FK を利用して旧 prb エイリアスのカラムを再現する。
 */
const PRB_COMPAT_SUBQUERY =
  '(SELECT rb_src.id AS post_id, rb_tgt.object_uri AS original_uri, ' +
  "COALESCE((SELECT pr.acct FROM profiles pr WHERE pr.id = rb_src.author_profile_id), '') AS reblogger_acct, " +
  'rb_src.created_at_ms AS reblogged_at_ms ' +
  'FROM posts rb_src ' +
  'INNER JOIN posts rb_tgt ON rb_src.reblog_of_post_id = rb_tgt.id ' +
  'WHERE rb_src.reblog_of_post_id IS NOT NULL)'

const EMPTY_PTT = `(SELECT NULL AS post_id, NULL AS timelineType LIMIT 0)`
const EMPTY_PHT = `(SELECT NULL AS post_id, NULL AS hashtag_id LIMIT 0)`
const EMPTY_HT = `(SELECT NULL AS hashtag_id, NULL AS name LIMIT 0)`
const EMPTY_PME = `(SELECT NULL AS post_id, NULL AS acct LIMIT 0)`
const EMPTY_PB = `(SELECT NULL AS post_id, NULL AS backendUrl, NULL AS local_id LIMIT 0)`
const EMPTY_PRB = `(SELECT NULL AS post_id, NULL AS original_uri, NULL AS reblogger_acct, NULL AS reblogged_at_ms LIMIT 0)`

/**
 * カスタム SQL WHERE 句でフィルタした Status / Notification を返す Hook
 *
 * config.customQuery が設定されている場合にのみ使用される。
 * LIMIT / OFFSET は自動設定され、ユーザーが指定した値は無視される。
 *
 * クエリが posts と notifications の両方のテーブルを参照する場合（混合クエリ）、
 * UNION ALL を使用して両テーブルから結果を取得し、created_at_ms でソートして返す。
 *
 * クエリ内で `n.` プレフィックスのみが使われている場合は notifications テーブルのみ、
 * それ以外の場合は posts テーブルのみを対象にクエリを実行する。
 *
 * ## v2 スキーマ対応
 *
 * - post_mentions (pme) テーブルを LEFT JOIN に追加
 * - onlyMedia フィルタは SQL の has_media カラムで処理（JS 側フィルタ不要）
 * - カスタムクエリモードでは applyMuteFilter / applyInstanceBlock は適用しない
 *
 * @param config — タイムライン設定。`customQuery` が空のときは DB を叩かず空配列を返す
 * @returns
 * - `data`: Status と Notification の判別付き `StatusAddAppIndex | NotificationAddAppIndex` の配列
 * - `queryDuration`: 直近クエリの実行時間（ms）、未計測時は `null`
 * - `loadMore`: 取得件数上限を `TIMELINE_QUERY_LIMIT` 分だけ増やして再取得する
 * @see {@link useTimelineData}
 */
export function useCustomQueryTimeline(config: TimelineConfigV2): {
  data: (NotificationAddAppIndex | StatusAddAppIndex)[]
  queryDuration: number | null
  loadMore: () => void
} {
  const apps = useContext(AppsContext)
  const [results, setResults] = useState<
    (
      | (SqliteStoredStatus & { _type: 'status' })
      | (SqliteStoredNotification & { _type: 'notification' })
    )[]
  >([])
  const [queryLimit, setQueryLimit] = useState(TIMELINE_QUERY_LIMIT)
  const { queryDuration, recordDuration } = useQueryDuration()

  // 非同期クエリの競合状態を防止するためのバージョンカウンター
  const fetchVersionRef = useRef(0)

  // 設定保存時に確実に再取得をトリガーするためのリフレッシュトークン
  const refreshToken = useConfigRefresh(config.id)

  const loadMore = useCallback(() => {
    setQueryLimit((prev) => prev + TIMELINE_QUERY_LIMIT)
  }, [])

  // config 変更時に queryLimit をリセット
  const configId = config.id
  useEffect(() => {
    // configId の変更を検知して初期値にリセット
    void configId
    setQueryLimit(TIMELINE_QUERY_LIMIT)
  }, [configId])

  const customQuery = config.customQuery ?? ''
  const onlyMedia = config.onlyMedia
  const minMediaCount = config.minMediaCount

  const queryMode = useMemo(() => {
    if (isMixedQuery(customQuery)) return 'mixed' as const
    if (isNotificationQuery(customQuery)) return 'notification' as const
    return 'status' as const
  }, [customQuery])

  const sessionTag = `custom-${configId}`

  // エンゲージメントスコープ用: 全バックエンド URL を安定した参照で保持
  const allBackendUrls = useMemo(() => apps.map((a) => a.backendUrl), [apps])

  const fetchData = useCallback(async () => {
    void refreshToken
    if (!customQuery.trim()) {
      setResults([])
      return
    }

    const version = ++fetchVersionRef.current

    try {
      const handle = await getSqliteDb()

      // 前回の fetchData で積んだ未処理クエリは sendRequest の
      // インプレース置換で自動的にキャンセルされるため、
      // cancelStaleRequests の明示呼び出しは不要

      // サニタイズ: DML/DDL拒否, セミコロン除去, LIMIT/OFFSET除去
      const forbidden =
        /\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i
      if (forbidden.test(customQuery)) {
        console.error('Custom query contains forbidden SQL statements.')
        setResults([])
        return
      }
      // SQLコメントも拒否（後続の backendUrl 条件のコメントアウト防止）
      if (/--/.test(customQuery) || /\/\*/.test(customQuery)) {
        console.error('Custom query contains SQL comments.')
        setResults([])
        return
      }
      const sanitized = upgradeQueryToV2(
        customQuery
          .replace(/;/g, '')
          .replace(/\bLIMIT\b\s+\d+/gi, '')
          .replace(/\bOFFSET\b\s+\d+/gi, '')
          .trim(),
      )

      if (!sanitized) {
        setResults([])
        return
      }

      // ? プレースホルダーのバインド競合を防止（文字列リテラル内は許可）
      if (hasUnquotedQuestionMark(sanitized)) {
        console.error('Custom query must not contain ? placeholders.')
        setResults([])
        return
      }

      if (queryMode === 'mixed') {
        // ============================
        // 混合クエリ: 2段階クエリ戦略
        // Phase1: 軽量な ID + created_at_ms のみ取得
        // Phase2: 取得した ID から詳細情報をフェッチ
        // ============================
        const refs = detectReferencedAliases(sanitized)
        // pb.backend_url / pb.backendUrl → la_pb.backend_url 書き換え
        const pbRewritten = sanitized
          .replace(/\bpb\.backend_url\b/g, 'la_pb.backend_url')
          .replace(/\bpb\.backendUrl\b/g, 'la_pb.backend_url')
        // 施策 A+B: 旧カラム名を正規化形式に書き換え、必要な互換 JOIN を導出
        const { rewrittenWhere, compatJoins } =
          rewriteLegacyColumnsForPhase1(pbRewritten)

        // --- Phase1: Status ID 取得（STATUS_BASE_JOINS を除外して軽量化） ---
        const statusPhase1JoinLines: string[] = []
        // 施策 A: 旧カラム参照に必要な互換 JOIN を追加
        statusPhase1JoinLines.push(...compatJoins)
        // pb は参照されている場合のみ JOIN（1:N のため GROUP BY が必要になる）
        if (refs.pb) {
          statusPhase1JoinLines.push(
            'LEFT JOIN post_backend_ids pb ON p.id = pb.post_id',
            'LEFT JOIN local_accounts la_pb ON la_pb.id = pb.local_account_id',
          )
        }
        // 1:N JOIN が存在する場合のみ GROUP BY が必要
        const statusHasMultiRowJoin =
          refs.pb ||
          refs.ptt ||
          refs.pbt ||
          refs.pme ||
          refs.prb ||
          refs.pe ||
          refs.ps ||
          refs.ht
        if (refs.ptt)
          statusPhase1JoinLines.push(
            `LEFT JOIN ${PTT_COMPAT} ptt\n              ON p.id = ptt.post_id`,
          )
        if (refs.pbt)
          statusPhase1JoinLines.push(
            'LEFT JOIN post_hashtags pht ON p.id = pht.post_id\n              LEFT JOIN hashtags ht ON pht.hashtag_id = ht.id',
          )
        if (refs.pme)
          statusPhase1JoinLines.push(
            'LEFT JOIN post_mentions pme\n              ON p.id = pme.post_id',
          )
        if (refs.prb)
          statusPhase1JoinLines.push(
            `LEFT JOIN ${PRB_COMPAT_SUBQUERY} prb\n              ON p.id = prb.post_id`,
          )
        if (refs.pe)
          statusPhase1JoinLines.push(
            'LEFT JOIN post_interactions pe\n              ON p.id = pe.post_id',
          )
        if (refs.pr)
          statusPhase1JoinLines.push(
            'LEFT JOIN profiles pr\n              ON pr.id = p.author_profile_id',
          )
        if (refs.vt)
          statusPhase1JoinLines.push(
            'LEFT JOIN visibility_types vt\n              ON vt.id = p.visibility_id',
          )
        if (refs.ps)
          statusPhase1JoinLines.push(
            'LEFT JOIN post_stats ps\n              ON ps.post_id = p.id',
          )
        if (refs.ht)
          statusPhase1JoinLines.push(
            'LEFT JOIN post_hashtags pht ON p.id = pht.post_id\n              LEFT JOIN hashtags ht ON pht.hashtag_id = ht.id',
          )
        // EMPTY_N は不要: Status 側では n.*/nt.*/ap.* は常に NULL のため、
        // WHERE 句の通知系エイリアス参照を直接 NULL に置換する。
        // これにより MATERIALIZE + SCAN n LEFT-JOIN のオーバーヘッドを排除し、
        // SQLite の定数畳み込みで不要な条件分岐が除去される。
        // 注: \b(n|nt|ap)\. は ntt./ntf./ap2. 等にはマッチしない（単語境界で区切られるため安全）
        const statusNullReplaced = rewrittenWhere.replace(
          /\b(n|nt|ap)\.\w+\b/g,
          'NULL',
        )

        // --- 施策D: 相関サブクエリに profile_id ヒント注入 ---
        // profiles.acct 比較を検出し、冗長な actor_profile_id = p.author_profile_id を注入
        // → idx_notifications_type_actor (notification_type_id, actor_profile_id, created_at_ms DESC) が使える
        const statusRewrittenWhere = injectProfileIdHint(statusNullReplaced)

        const statusPhase1Joins = `\n            ${statusPhase1JoinLines.join('\n            ')}`

        let statusMediaConditions = ''
        const statusMediaBinds: (string | number)[] = []
        if (minMediaCount != null && minMediaCount > 0) {
          statusMediaConditions +=
            '\n              AND (SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= ?'
          statusMediaBinds.push(minMediaCount)
        } else if (onlyMedia) {
          statusMediaConditions +=
            '\n              AND EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)'
        }

        // 施策 A: サブクエリ廃止 → FROM posts p 直接参照
        // 1:N JOIN がなければ GROUP BY 不要 → idx_posts_created で ORDER BY + LIMIT early termination が効く
        const statusGroupBy = statusHasMultiRowJoin
          ? '\n          GROUP BY p.id'
          : ''

        // --- Phase1: Notification ID 取得 ---
        const notifDummyJoins = [
          `LEFT JOIN ${EMPTY_S} p ON 1 = 1`,
          `LEFT JOIN ${EMPTY_PTT} ptt ON 1 = 1`,
          `LEFT JOIN ${EMPTY_PHT} pht ON 1 = 1`,
          `LEFT JOIN ${EMPTY_HT} ht ON 1 = 1`,
          `LEFT JOIN ${EMPTY_PME} pme ON 1 = 1`,
          `LEFT JOIN ${EMPTY_PB} pb ON 1 = 1`,
          `LEFT JOIN ${EMPTY_PRB} prb ON 1 = 1`,
        ].join('\n            ')

        const rewrittenNotifWhere = sanitized

        const notifPhase1Sql = `
          SELECT n.id, n.created_at_ms
          FROM ${NOTIF_COMPAT_FROM}
          ${NOTIFICATION_BASE_JOINS}
            ${notifDummyJoins}
          WHERE (${rewrittenNotifWhere})
          ORDER BY n.created_at_ms DESC
          LIMIT ?;
        `

        // --- Phase1 実行: Notification を先に実行し、結果で Status のスキャン範囲を制限 ---
        // Notification Phase1 が queryLimit 件に達していれば、最古の created_at_ms より
        // 古い Status は merged 結果に入らないため、時間下限を付与してスキャン範囲を削減。
        // これにより相関サブクエリの評価回数を大幅に削減できる。
        const { result: notifIdRowsRaw, durationMs: notifPhase1Dur } =
          await handle.execAsyncTimed(notifPhase1Sql, {
            bind: [queryLimit],
            kind: 'timeline',
            returnValue: 'resultRows',
            sessionTag,
          })
        // sendRequest のインプレース置換でキャンセルされた場合 result は undefined になる
        if (!notifIdRowsRaw) return
        const notifIdRows = notifIdRowsRaw as (string | number | null)[][]

        // Notification が queryLimit 件以上 → 時間下限を導出
        let statusTimeBound = ''
        const statusTimeBoundBinds: number[] = []
        if (notifIdRows.length >= queryLimit) {
          let oldestNotifTime = Number.POSITIVE_INFINITY
          for (const row of notifIdRows) {
            const t = row[1] as number
            if (t < oldestNotifTime) oldestNotifTime = t
          }
          if (Number.isFinite(oldestNotifTime)) {
            statusTimeBound = '\n              AND p.created_at_ms >= ?'
            statusTimeBoundBinds.push(oldestNotifTime)
          }
        }

        // --- 施策E: アクター事前フィルタ ---
        // 相関サブクエリが notifications テーブルを参照する場合、
        // マッチする actor_profile_id を事前取得して外側スキャン行数を削減する。
        // EXISTS (not NOT EXISTS) + notifications + acct 比較パターンのみ対象。
        let statusAuthorPreFilter = ''
        const statusHintWasInjected =
          statusRewrittenWhere !== statusNullReplaced
        if (
          statusHintWasInjected &&
          !/\bNOT\s+EXISTS\b/i.test(statusRewrittenWhere)
        ) {
          const typeCodes = extractNotificationTypeCodes(statusRewrittenWhere)
          let actorSql: string
          let actorBinds: (string | number)[]

          if (typeCodes && typeCodes.length > 0) {
            const placeholders = typeCodes.map(() => '?').join(',')
            actorSql = `
              SELECT DISTINCT ntf.actor_profile_id
              FROM notifications ntf
              INNER JOIN notification_types ntt
                ON ntt.id = ntf.notification_type_id
              WHERE ntt.name IN (${placeholders})`
            actorBinds = typeCodes
          } else {
            actorSql = 'SELECT DISTINCT actor_profile_id FROM notifications'
            actorBinds = []
          }

          const actorRows = (await handle.execAsync(actorSql, {
            bind: actorBinds,
            returnValue: 'resultRows',
          })) as (number | null)[][]

          const actorProfileIds = actorRows
            .map((r) => r[0])
            .filter((id): id is number => id !== null)

          if (actorProfileIds.length > 0 && actorProfileIds.length <= 500) {
            statusAuthorPreFilter = `\n              AND p.author_profile_id IN (${actorProfileIds.join(',')})`
          }
        }

        const statusPhase1Sql = `
          SELECT p.id, p.created_at_ms${refs.pb ? ', MIN(la_pb.backend_url) AS backendUrl' : ''}
          FROM posts p${statusPhase1Joins}
          WHERE (${statusRewrittenWhere})${statusMediaConditions}${statusTimeBound}${statusAuthorPreFilter}${statusGroupBy}
          ORDER BY p.created_at_ms DESC
          LIMIT ?;
        `

        const { result: statusIdRowsRaw, durationMs: statusPhase1Dur } =
          await handle.execAsyncTimed(statusPhase1Sql, {
            bind: [...statusMediaBinds, ...statusTimeBoundBinds, queryLimit],
            kind: 'timeline',
            returnValue: 'resultRows',
            sessionTag,
          })
        // sendRequest のインプレース置換でキャンセルされた場合 result は undefined になる
        if (!statusIdRowsRaw) return
        const statusIdRows = statusIdRowsRaw as (string | number | null)[][]

        // Phase1 結果を統合・ソートして上位 queryLimit 件を選定
        const statusBackendUrlMap = new Map<number, string>()
        const statusIds = statusIdRows.map((row) => {
          if (refs.pb && row[2] != null) {
            statusBackendUrlMap.set(row[0] as number, row[2] as string)
          }
          return {
            created_at_ms: row[1] as number,
            id: row[0] as number,
            type: 'status' as const,
          }
        })
        const notifIds = notifIdRows.map((row) => ({
          created_at_ms: row[1] as number,
          id: row[0] as number,
          type: 'notification' as const,
        }))
        const merged = [...statusIds, ...notifIds]
          .sort((a, b) => b.created_at_ms - a.created_at_ms)
          .slice(0, queryLimit)

        const postIdsToFetch = merged
          .filter((m) => m.type === 'status')
          .map((m) => m.id)
        const notifIdsToFetch = merged
          .filter((m) => m.type === 'notification')
          .map((m) => m.id)

        // --- Phase2: 詳細情報取得 (バッチクエリ版) ---
        let statusResults: (SqliteStoredStatus & { _type: 'status' })[] = []
        let statusPhase2Dur = 0
        if (postIdsToFetch.length > 0) {
          const placeholders = postIdsToFetch.map(() => '?').join(',')
          const statusBaseSql = `
            SELECT ${STATUS_BASE_SELECT}
            FROM posts p
            ${STATUS_BASE_JOINS}
            WHERE p.id IN (${placeholders})
            GROUP BY p.id
            ORDER BY p.created_at_ms DESC;
          `
          const { result: statusBaseRowsRaw, durationMs: dur } =
            await handle.execAsyncTimed(statusBaseSql, {
              bind: postIdsToFetch,
              kind: 'timeline',
              returnValue: 'resultRows',
              sessionTag,
            })
          // sendRequest のインプレース置換でキャンセルされた場合 result は undefined になる
          if (!statusBaseRowsRaw) return
          const statusBaseRows = statusBaseRowsRaw as (
            | string
            | number
            | null
          )[][]

          // リブログ元の post_id を収集
          const reblogPostIds: number[] = []
          for (const row of statusBaseRows) {
            const rbPostId = row[27] as number | null
            if (rbPostId !== null) reblogPostIds.push(rbPostId)
          }
          const allPostIds = [...new Set([...postIdsToFetch, ...reblogPostIds])]

          // 子テーブルバッチクエリを並列実行
          const maps = await executeBatchQueries(handle, allPostIds, {
            interactionsSql: buildScopedEngagementsSql(
              allBackendUrls,
              '__PH__',
            ),
          })

          statusPhase2Dur = dur
          statusResults = statusBaseRows.map((row) => {
            const status = assembleStatusFromBatch(row, maps)
            const postId = row[0] as number
            status.backendUrl =
              statusBackendUrlMap.get(postId) ?? status.backendUrl
            return { ...status, _type: 'status' as const }
          })
        }

        let notifResults: (SqliteStoredNotification & {
          _type: 'notification'
        })[] = []
        let notifPhase2Dur = 0
        if (notifIdsToFetch.length > 0) {
          const placeholders = notifIdsToFetch.map(() => '?').join(',')
          const notifDetailSql = `
            SELECT ${NOTIFICATION_SELECT}
            FROM ${NOTIF_COMPAT_FROM}
            ${NOTIFICATION_BASE_JOINS}
            WHERE n.id IN (${placeholders})
            ORDER BY n.created_at_ms DESC;
          `
          const { result: notifDetailRowsRaw, durationMs: dur } =
            await handle.execAsyncTimed(notifDetailSql, {
              bind: notifIdsToFetch,
              kind: 'timeline',
              returnValue: 'resultRows',
              sessionTag,
            })
          notifPhase2Dur = dur
          // sendRequest のインプレース置換でキャンセルされた場合 result は undefined になる
          if (!notifDetailRowsRaw) return
          const notifDetailRows = notifDetailRowsRaw as (
            | string
            | number
            | null
          )[][]
          notifResults = notifDetailRows.map((row) => ({
            ...rowToStoredNotification(row),
            _type: 'notification' as const,
          }))
        }

        recordDuration(
          statusPhase1Dur + notifPhase1Dur + statusPhase2Dur + notifPhase2Dur,
        )

        const mixed = [...statusResults, ...notifResults]
          .sort((a, b) => b.created_at_ms - a.created_at_ms)
          .slice(0, queryLimit)

        // 古い非同期クエリの結果が新しいクエリの結果を上書きしないようにする
        if (fetchVersionRef.current !== version) return
        setResults(mixed)
      } else if (queryMode === 'notification') {
        // ============================
        // Notifications クエリ
        // ============================
        const binds: (string | number)[] = [queryLimit]

        const rewrittenNotifWhere = sanitized

        const sql = `
          SELECT ${NOTIFICATION_SELECT}
          FROM ${NOTIF_COMPAT_FROM}
          ${NOTIFICATION_BASE_JOINS}
          WHERE (${rewrittenNotifWhere})
          ORDER BY n.created_at_ms DESC
          LIMIT ?;
        `

        const { result: rowsRaw, durationMs } = await handle.execAsyncTimed(
          sql,
          {
            bind: binds,
            kind: 'timeline',
            returnValue: 'resultRows',
            sessionTag,
          },
        )
        // sendRequest のインプレース置換でキャンセルされた場合 result は undefined になる
        if (!rowsRaw) return
        const rows = rowsRaw as (string | number | null)[][]
        recordDuration(durationMs)

        const notifResults = rows.map((row) => ({
          ...rowToStoredNotification(row),
          _type: 'notification' as const,
        }))

        // 古い非同期クエリの結果が新しいクエリの結果を上書きしないようにする
        if (fetchVersionRef.current !== version) return
        setResults(notifResults)
      } else {
        // ============================
        // Statuses クエリ: 2段階クエリ戦略
        // ============================
        const refs = detectReferencedAliases(sanitized)
        // pb.backend_url / pb.backendUrl → la_pb.backend_url 書き換え
        const pbRewritten = sanitized
          .replace(/\bpb\.backend_url\b/g, 'la_pb.backend_url')
          .replace(/\bpb\.backendUrl\b/g, 'la_pb.backend_url')
        // 施策 A+B: 旧カラム名を正規化形式に書き換え、必要な互換 JOIN を導出
        const { rewrittenWhere: rawRewrittenWhere, compatJoins } =
          rewriteLegacyColumnsForPhase1(pbRewritten)

        // --- 施策D: 相関サブクエリに profile_id ヒント注入 ---
        const rewrittenWhere = injectProfileIdHint(rawRewrittenWhere)
        const statusOnlyHintInjected = rewrittenWhere !== rawRewrittenWhere

        const joinLines: string[] = []
        // 施策 A: 旧カラム参照に必要な互換 JOIN を追加
        joinLines.push(...compatJoins)
        // pb は参照されている場合のみ JOIN（1:N のため DISTINCT が必要になる）
        if (refs.pb) {
          joinLines.push(
            'LEFT JOIN post_backend_ids pb ON p.id = pb.post_id',
            'LEFT JOIN local_accounts la_pb ON la_pb.id = pb.local_account_id',
          )
        }
        // 1:N JOIN が存在する場合のみ DISTINCT が必要
        const hasMultiRowJoin =
          refs.pb ||
          refs.ptt ||
          refs.pbt ||
          refs.pme ||
          refs.prb ||
          refs.pe ||
          refs.ps ||
          refs.ht
        if (refs.ptt)
          joinLines.push(
            `LEFT JOIN ${PTT_COMPAT} ptt\n            ON p.id = ptt.post_id`,
          )
        if (refs.pbt)
          joinLines.push(
            'LEFT JOIN post_hashtags pht ON p.id = pht.post_id\n            LEFT JOIN hashtags ht ON pht.hashtag_id = ht.id',
          )
        if (refs.pme)
          joinLines.push(
            'LEFT JOIN post_mentions pme\n            ON p.id = pme.post_id',
          )
        if (refs.prb)
          joinLines.push(
            `LEFT JOIN ${PRB_COMPAT_SUBQUERY} prb\n            ON p.id = prb.post_id`,
          )
        if (refs.pe)
          joinLines.push(
            'LEFT JOIN post_interactions pe\n            ON p.id = pe.post_id',
          )
        if (refs.pr)
          joinLines.push(
            'LEFT JOIN profiles pr\n            ON pr.id = p.author_profile_id',
          )
        if (refs.vt)
          joinLines.push(
            'LEFT JOIN visibility_types vt\n            ON vt.id = p.visibility_id',
          )
        if (refs.ps)
          joinLines.push(
            'LEFT JOIN post_stats ps\n            ON ps.post_id = p.id',
          )
        if (refs.ht)
          joinLines.push(
            'LEFT JOIN post_hashtags pht ON p.id = pht.post_id\n            LEFT JOIN hashtags ht ON pht.hashtag_id = ht.id',
          )

        const joinsClause = `\n          ${joinLines.join('\n          ')}`

        let additionalConditions = ''
        const additionalBinds: (string | number)[] = []

        if (minMediaCount != null && minMediaCount > 0) {
          additionalConditions +=
            '\n          AND (SELECT COUNT(*) FROM post_media WHERE post_id = p.id) >= ?'
          additionalBinds.push(minMediaCount)
        } else if (onlyMedia) {
          additionalConditions +=
            '\n          AND EXISTS(SELECT 1 FROM post_media WHERE post_id = p.id)'
        }

        // Phase1: 軽量な post_id のみ取得（施策 A: サブクエリ廃止）
        // 1:N JOIN がなければ DISTINCT 不要 → idx_posts_created で ORDER BY + LIMIT early termination が効く
        // pb が参照されている場合は MIN(la_pb.backend_url) を取得し Phase2 後に上書きする
        let selectClause: string
        let groupByClause: string
        if (refs.pb) {
          selectClause = 'SELECT p.id, MIN(la_pb.backend_url) AS backendUrl'
          groupByClause = '\n          GROUP BY p.id'
        } else if (hasMultiRowJoin) {
          selectClause = 'SELECT DISTINCT p.id'
          groupByClause = ''
        } else {
          selectClause = 'SELECT p.id'
          groupByClause = ''
        }
        // --- 施策E: アクター事前フィルタ ---
        let statusOnlyAuthorPreFilter = ''
        if (
          statusOnlyHintInjected &&
          !/\bNOT\s+EXISTS\b/i.test(rewrittenWhere)
        ) {
          const typeCodes = extractNotificationTypeCodes(rewrittenWhere)
          let actorSql: string
          let actorBinds: (string | number)[]

          if (typeCodes && typeCodes.length > 0) {
            const placeholders = typeCodes.map(() => '?').join(',')
            actorSql = `
              SELECT DISTINCT ntf.actor_profile_id
              FROM notifications ntf
              INNER JOIN notification_types ntt
                ON ntt.id = ntf.notification_type_id
              WHERE ntt.name IN (${placeholders})`
            actorBinds = typeCodes
          } else {
            actorSql = 'SELECT DISTINCT actor_profile_id FROM notifications'
            actorBinds = []
          }

          const actorRows = (await handle.execAsync(actorSql, {
            bind: actorBinds,
            returnValue: 'resultRows',
          })) as (number | null)[][]

          const actorProfileIds = actorRows
            .map((r) => r[0])
            .filter((id): id is number => id !== null)

          if (actorProfileIds.length > 0 && actorProfileIds.length <= 500) {
            statusOnlyAuthorPreFilter = `\n          AND p.author_profile_id IN (${actorProfileIds.join(',')})`
          }
        }

        const phase1Sql = `
          ${selectClause}
          FROM posts p${joinsClause}
          WHERE (${rewrittenWhere})${additionalConditions}${statusOnlyAuthorPreFilter}${groupByClause}
          ORDER BY p.created_at_ms DESC
          LIMIT ?;
        `
        const phase1Binds: (string | number)[] = [
          ...additionalBinds,
          queryLimit,
        ]

        // === 一括取得: Phase1 → Phase2 → Batch×7 を Worker 内で実行 ===
        const fetchResult = await handle.fetchTimeline(
          {
            batchSqls: buildScopedBatchTemplates(allBackendUrls),
            phase1: { bind: phase1Binds, sql: phase1Sql },
            phase2BaseSql: PHASE2_BASE_TEMPLATE,
          },
          sessionTag,
        )

        // sendRequest のインプレース置換でキャンセルされた場合 result は undefined になる
        if (!fetchResult) return
        const idRows = fetchResult.phase1Rows

        const backendUrlMap = new Map<number, string>()
        if (refs.pb) {
          for (const row of idRows) {
            if (row[1] != null) {
              backendUrlMap.set(row[0] as number, row[1] as string)
            }
          }
        }
        const postIds = idRows.map((row) => row[0] as number)

        if (postIds.length === 0) {
          recordDuration(fetchResult.totalDurationMs)
          if (fetchVersionRef.current !== version) return
          setResults([])
          return
        }

        // バッチ結果を Map に変換
        const maps = buildBatchMapsFromResults(fetchResult.batchResults)

        recordDuration(fetchResult.totalDurationMs)

        const statusResults = fetchResult.phase2Rows.map((row) => {
          const status = assembleStatusFromBatch(row, maps)
          const postId = row[0] as number
          status.backendUrl = backendUrlMap.get(postId) ?? status.backendUrl
          return { ...status, _type: 'status' as const }
        })

        // 古い非同期クエリの結果が新しいクエリの結果を上書きしないようにする
        if (fetchVersionRef.current !== version) return
        setResults(statusResults)
      }
    } catch (e) {
      console.error('useCustomQueryTimeline query error:', e)
    }
  }, [
    customQuery,
    onlyMedia,
    minMediaCount,
    queryMode,
    queryLimit,
    recordDuration,
    refreshToken,
    sessionTag,
    allBackendUrls,
  ])

  // 施策 C: subscribe コールバックのデバウンス (500ms)
  // connection.ts の 80ms デバウンスに加え、Hook レベルでも
  // ストリーミングバーストによる重複クエリ実行を抑制する
  const debouncedFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )

  useEffect(() => {
    fetchData() // 初回は即時実行

    // subscribe コールバック用のデバウンスラッパー
    const debouncedFetch = (_hints: ChangeHint[]) => {
      if (debouncedFetchTimerRef.current != null) {
        clearTimeout(debouncedFetchTimerRef.current)
      }
      debouncedFetchTimerRef.current = setTimeout(() => {
        debouncedFetchTimerRef.current = null
        fetchData()
      }, 500)
    }

    // 監視するテーブルはクエリモードに応じて決定
    const unsubStatuses =
      queryMode !== 'notification'
        ? subscribe('posts', debouncedFetch)
        : undefined
    const unsubNotifications =
      queryMode !== 'status'
        ? subscribe('notifications', debouncedFetch)
        : undefined
    return () => {
      unsubStatuses?.()
      unsubNotifications?.()
      if (debouncedFetchTimerRef.current != null) {
        clearTimeout(debouncedFetchTimerRef.current)
        debouncedFetchTimerRef.current = null
      }
    }
  }, [fetchData, queryMode])

  const data = useMemo(
    () =>
      results
        .map((item) => ({
          ...item,
          appIndex: resolveAppIndex(item.backendUrl, apps),
        }))
        .filter((item) => item.appIndex !== -1),
    [results, apps],
  )

  return { data, loadMore, queryDuration }
}
