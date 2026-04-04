// ============================================================
// Query mode detection
// ============================================================
//
// WHERE 句が status / notification / mixed のどれを参照しているか判定する。

/** クエリモード判定結果 */
export type QueryMode = 'status' | 'notification' | 'mixed'

const STATUS_ALIASES = /\b(p|ptt|pme|pb|prb|pr|vt|ps|ht|pe)\.\w/
const NOTIFICATION_ALIASES = /\b(n|nt|ap)\.\w/

/**
 * WHERE 句のクエリモードを判定する。
 * status テーブルのエイリアスと notification テーブルのエイリアスの
 * 両方が参照されている場合は 'mixed'。
 */
export function detectQueryMode(where: string): QueryMode {
  const hasStatus = STATUS_ALIASES.test(where)
  const hasNotification = NOTIFICATION_ALIASES.test(where)

  if (hasStatus && hasNotification) return 'mixed'
  if (hasNotification) return 'notification'
  return 'status'
}
