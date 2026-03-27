/**
 * 投稿の投票データを polls / poll_options に同期する。
 */
export function syncPollData(
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  },
  postId: number,
  poll: {
    expires_at: string | null
    multiple: boolean
    votes_count: number
    options: { title: string; votes_count: number | null }[]
    voted: boolean
  } | null,
): void {
  if (!poll) {
    db.exec('DELETE FROM polls WHERE post_id = ?;', { bind: [postId] })
    return
  }

  db.exec(
    `INSERT INTO polls (post_id, expires_at, multiple, votes_count, voters_count)
     VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(post_id) DO UPDATE SET
       expires_at   = excluded.expires_at,
       multiple     = excluded.multiple,
       votes_count  = excluded.votes_count;`,
    {
      bind: [postId, poll.expires_at, poll.multiple ? 1 : 0, poll.votes_count],
    },
  )

  const pollRows = db.exec('SELECT poll_id FROM polls WHERE post_id = ?;', {
    bind: [postId],
    returnValue: 'resultRows',
  }) as number[][]
  const pollId = pollRows[0][0]

  // Poll options: UPSERT instead of delete-all
  for (let i = 0; i < poll.options.length; i++) {
    const opt = poll.options[i]
    db.exec(
      `INSERT INTO poll_options (poll_id, option_index, title, votes_count)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(poll_id, option_index) DO UPDATE SET
         title = excluded.title,
         votes_count = excluded.votes_count;`,
      { bind: [pollId, i, opt.title, opt.votes_count] },
    )
  }

  // Remove excess options (in case the number of options decreased)
  db.exec('DELETE FROM poll_options WHERE poll_id = ? AND option_index >= ?;', {
    bind: [pollId, poll.options.length],
  })
}
