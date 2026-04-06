import type { WrittenTableCollector } from '../protocol'
import type { DbExecCompat } from './types'

/**
 * 投票データを同期する。
 * polls テーブルに UPSERT し、poll_options を DELETE + INSERT で再同期する。
 */
export function syncPollData(
  db: DbExecCompat,
  postId: number,
  poll:
    | {
        id?: string
        expires_at?: string | null
        expired?: boolean
        multiple?: boolean
        votes_count?: number
        options: { title: string; votes_count?: number | null }[]
      }
    | null
    | undefined,
  collector?: WrittenTableCollector,
): void {
  if (!poll) return

  // polls テーブルに UPSERT
  db.exec(
    `INSERT INTO polls (post_id, poll_local_id, expires_at, expired, multiple, votes_count)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(post_id) DO UPDATE SET
       poll_local_id = excluded.poll_local_id,
       expires_at    = excluded.expires_at,
       expired       = excluded.expired,
       multiple      = excluded.multiple,
       votes_count   = excluded.votes_count;`,
    {
      bind: [
        postId,
        poll.id ?? null,
        poll.expires_at ?? null,
        poll.expired ? 1 : 0,
        poll.multiple ? 1 : 0,
        poll.votes_count ?? 0,
      ],
    },
  )
  collector?.add('polls')

  // poll ID を取得
  const rows = db.exec('SELECT id FROM polls WHERE post_id = ?;', {
    bind: [postId],
    returnValue: 'resultRows',
  }) as number[][]

  if (rows.length === 0) return
  const pollId = rows[0][0]

  // poll_options を再同期（DELETE + multi-value INSERT）
  db.exec('DELETE FROM poll_options WHERE poll_id = ?;', { bind: [pollId] })

  if (poll.options.length > 0) {
    const placeholders: string[] = []
    const binds: (string | number | null)[] = []

    for (let i = 0; i < poll.options.length; i++) {
      const opt = poll.options[i]
      placeholders.push('(?, ?, ?, ?)')
      binds.push(pollId, i, opt.title, opt.votes_count ?? null)
    }

    db.exec(
      `INSERT INTO poll_options (poll_id, sort_order, title, votes_count) VALUES ${placeholders.join(',')};`,
      { bind: binds },
    )
  }
  collector?.add('poll_options')
}

/**
 * 投票状態を同期する。
 * poll_votes テーブルに UPSERT する。
 */
export function syncPollVotes(
  db: DbExecCompat,
  postId: number,
  localAccountId: number,
  voted: boolean,
  ownVotes: number[],
): void {
  // poll ID を取得
  const rows = db.exec('SELECT id FROM polls WHERE post_id = ?;', {
    bind: [postId],
    returnValue: 'resultRows',
  }) as number[][]

  if (rows.length === 0) return
  const pollId = rows[0][0]

  db.exec(
    `INSERT INTO poll_votes (poll_id, local_account_id, voted, own_votes_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(poll_id, local_account_id) DO UPDATE SET
       voted          = excluded.voted,
       own_votes_json = excluded.own_votes_json;`,
    {
      bind: [pollId, localAccountId, voted ? 1 : 0, JSON.stringify(ownVotes)],
    },
  )
}
